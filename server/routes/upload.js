const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csvParser = require('csv-parser');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const DataProcessor = require('../utils/dataProcessor');
const datasetStore = require('../utils/datasetStore');

const router = express.Router();

// File upload limits
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '100') * 1024 * 1024;
const MAX_DATASETS_PER_TENANT = parseInt(process.env.MAX_DATASETS_PER_TENANT || '50');
const ALLOWED_EXTS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.xlsx', '.xls']);

// MIME magic-byte signatures. We sniff the first ~512 bytes to confirm the
// file actually matches its extension — extension alone is forgeable.
async function sniffFileType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    if (bytesRead === 0) return 'empty';
    // ZIP-based formats (xlsx is a zip): PK\x03\x04
    if (buf[0] === 0x50 && buf[1] === 0x4B && (buf[2] === 0x03 || buf[2] === 0x05)) {
      return 'zip';
    }
    // OLE2 (legacy xls): D0 CF 11 E0
    if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
      return 'ole';
    }
    // Plain text — heuristic check that bytes are mostly printable
    const printable = buf.slice(0, bytesRead).filter(b =>
      b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || b >= 0x80
    ).length;
    if (printable / bytesRead > 0.9) return 'text';
    return 'binary';
  } finally {
    fs.closeSync(fd);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename — prevent path traversal even though multer stores
    // by uuid. Defense-in-depth: a malicious original filename should not
    // affect anything on disk.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return cb(new Error('Unsupported file type. Use CSV, TSV, JSON, JSONL, or Excel.'));
    }
    cb(null, true);
  },
});

// Stream CSV to handle large files without loading entire file into memory at once
function parseCSVStream(filePath, sep) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let count = 0;
    const stream = fs.createReadStream(filePath).pipe(csvParser({ separator: sep }));
    stream.on('data', r => {
      rows.push(r);
      count++;
      if (count % 50000 === 0 && global.gc) global.gc();
    });
    stream.on('end', () => resolve(rows));
    stream.on('error', reject);
  });
}

// Stream JSONL — line by line, never load the whole file
function parseJSONLStream(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try { rows.push(JSON.parse(line)); } catch (_) { /* skip bad line */ }
        }
      }
    });
    stream.on('end', () => {
      const tail = buffer.trim();
      if (tail) {
        try { rows.push(JSON.parse(tail)); } catch (_) {}
      }
      resolve(rows);
    });
    stream.on('error', reject);
  });
}

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fp = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let data = [];

    // Per-tenant dataset quota — prevents one user from exhausting disk
    if (req.user?.id) {
      const existing = datasetStore.size(req.user.id);
      if (existing >= MAX_DATASETS_PER_TENANT) {
        try { fs.unlinkSync(fp); } catch (_) {}
        return res.status(429).json({
          error: `Dataset limit reached (${MAX_DATASETS_PER_TENANT}). Delete existing datasets to upload more.`,
        });
      }
    }

    // MIME sniff: verify the file is what its extension claims to be.
    // A renamed binary uploaded as .csv shouldn't reach the parser.
    const fileType = await sniffFileType(fp);
    const expectedType = (ext === '.xlsx') ? 'zip' : (ext === '.xls') ? 'ole' : 'text';
    if (fileType !== expectedType && fileType !== 'empty') {
      try { fs.unlinkSync(fp); } catch (_) {}
      return res.status(400).json({
        error: `File contents don't match extension ${ext}. Expected ${expectedType}, got ${fileType}.`,
      });
    }

    console.log(`  📥 Parsing ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)...`);
    const t0 = Date.now();

    if (ext === '.csv' || ext === '.tsv') {
      data = await parseCSVStream(fp, ext === '.tsv' ? '\t' : ',');
    } else if (ext === '.json') {
      // For JSON we still need readFileSync — JSON isn't streamable in general
      // because it could be a single object. But we cap the file size
      // separately for JSON to stop a 100MB JSON from blowing memory.
      const stat = fs.statSync(fp);
      if (stat.size > 50 * 1024 * 1024) {
        try { fs.unlinkSync(fp); } catch (_) {}
        return res.status(413).json({
          error: 'JSON files larger than 50MB are not supported. Convert to JSONL (one record per line) for streaming support.',
        });
      }
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (Array.isArray(raw)) {
        data = raw;
      } else if (raw && typeof raw === 'object') {
        const arrayKey = Object.keys(raw).find(k => Array.isArray(raw[k]));
        data = arrayKey ? raw[arrayKey] : [raw];
      } else {
        data = [raw];
      }
    } else if (ext === '.jsonl' || ext === '.ndjson') {
      data = await parseJSONLStream(fp);
    } else if (ext === '.xlsx' || ext === '.xls') {
      // xlsx library has known prototype-pollution CVEs. Use the safest
      // possible options: ignore formulas (no recalc), don't process
      // styles, single-sheet only.
      const wb = XLSX.readFile(fp, {
        dense: true,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        bookVBA: false,
      });
      data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    }
    fs.unlinkSync(fp);

    if (!data.length) return res.status(400).json({ error: 'No data found in file' });

    console.log(`  ✓ Parsed ${data.length} rows in ${Date.now() - t0}ms. Analyzing...`);
    const t1 = Date.now();
    const analysis = DataProcessor.analyzeDataset(data);
    console.log(`  ✓ Analysis complete in ${Date.now() - t1}ms.`);

    const id = uuidv4();
    const dataset = {
      id, fileName: req.file.originalname, fileSize: req.file.size,
      data, analysis, uploadedAt: new Date().toISOString(),
      ownerId: req.user?.id,
    };
    datasetStore.set(id, dataset);

    res.json({
      datasetId: id, fileName: req.file.originalname, fileSize: req.file.size,
      rowCount: data.length, columnCount: Object.keys(data[0]).length, analysis,
    });
  } catch (err) {
    console.error('Upload error:', err);
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/data', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  res.json({
    datasetId: ds.id, page, limit, total: ds.data.length,
    data: ds.data.slice((page - 1) * limit, page * limit),
  });
});

router.delete('/:id', (req, res) => {
  res.json({ deleted: datasetStore.delete(req.params.id, req.user?.id) });
});

router.get('/', (req, res) => {
  res.json({ datasets: datasetStore.list(req.user?.id) });
});

router.datasets = datasetStore;
module.exports = router;
