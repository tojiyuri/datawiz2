const express = require('express');
const { v4: uuidv4 } = require('uuid');
const DataProcessor = require('../utils/dataProcessor');
const datasetStore = require('../utils/datasetStore');
const router = express.Router();

router.post('/', (req, res) => {
  try {
    const { name, columns, rows } = req.body;
    if (!Array.isArray(columns) || !columns.length) return res.status(400).json({ error: 'Columns required' });
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'At least one row required' });

    const data = rows.map(row => {
      const obj = {};
      columns.forEach((col, idx) => {
        let val = row[idx];
        if (val === '' || val === null || val === undefined) obj[col.name] = null;
        else if (col.type === 'numeric') {
          const n = Number(val); obj[col.name] = isNaN(n) ? null : n;
        }
        else obj[col.name] = val;
      });
      return obj;
    });

    const analysis = DataProcessor.analyzeDataset(data);
    const id = uuidv4();
    const fileName = (name || 'custom-dataset').replace(/[^a-z0-9_-]/gi, '_') + '.csv';
    datasetStore.set(id, {
      id, ownerId: req.user?.id, fileName, fileSize: JSON.stringify(data).length,
      data, analysis, uploadedAt: new Date().toISOString(),
    });
    res.json({ datasetId: id, fileName, rowCount: data.length, columnCount: columns.length, analysis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/templates', (req, res) => {
  res.json({
    templates: [
      { id: 'sales', name: 'Sales Tracker', description: 'Track daily sales with product, quantity, revenue',
        columns: [
          { name: 'Date', type: 'temporal' }, { name: 'Product', type: 'categorical' },
          { name: 'Category', type: 'categorical' }, { name: 'Quantity', type: 'numeric' },
          { name: 'Price', type: 'numeric' }, { name: 'Revenue', type: 'numeric' },
        ],
        sampleRows: [
          ['2024-01-15', 'Coffee', 'Beverages', 3, 4.5, 13.5],
          ['2024-01-15', 'Sandwich', 'Food', 2, 8.0, 16.0],
          ['2024-01-16', 'Coffee', 'Beverages', 5, 4.5, 22.5],
        ],
      },
      { id: 'inventory', name: 'Inventory Manager', description: 'Manage stock levels by SKU',
        columns: [
          { name: 'SKU', type: 'categorical' }, { name: 'ProductName', type: 'categorical' },
          { name: 'Category', type: 'categorical' }, { name: 'StockQty', type: 'numeric' },
          { name: 'ReorderPoint', type: 'numeric' }, { name: 'UnitCost', type: 'numeric' },
        ],
        sampleRows: [
          ['SKU001', 'Widget A', 'Hardware', 150, 50, 12.50],
          ['SKU002', 'Widget B', 'Hardware', 30, 50, 8.75],
          ['SKU003', 'Gadget X', 'Electronics', 200, 100, 45.00],
        ],
      },
      { id: 'customers', name: 'Customer Database', description: 'Customer info with purchase history',
        columns: [
          { name: 'CustomerID', type: 'categorical' }, { name: 'Name', type: 'text' },
          { name: 'City', type: 'categorical' }, { name: 'TotalSpent', type: 'numeric' },
          { name: 'OrderCount', type: 'numeric' }, { name: 'JoinDate', type: 'temporal' },
        ],
        sampleRows: [
          ['C001', 'Aarav Sharma', 'Mumbai', 4500, 12, '2023-06-10'],
          ['C002', 'Priya Patel', 'Pune', 2100, 7, '2023-08-22'],
          ['C003', 'Rahul Singh', 'Delhi', 8900, 23, '2023-04-05'],
        ],
      },
      { id: 'expenses', name: 'Expense Tracker', description: 'Track business expenses by category',
        columns: [
          { name: 'Date', type: 'temporal' }, { name: 'Category', type: 'categorical' },
          { name: 'Vendor', type: 'categorical' }, { name: 'Amount', type: 'numeric' },
          { name: 'PaymentMethod', type: 'categorical' },
        ],
        sampleRows: [
          ['2024-01-05', 'Rent', 'Landlord', 25000, 'Bank Transfer'],
          ['2024-01-08', 'Utilities', 'Electric Co', 3200, 'Credit Card'],
          ['2024-01-12', 'Supplies', 'Stationery Inc', 850, 'Cash'],
        ],
      },
      { id: 'employees', name: 'Staff Register', description: 'Employee data with department and salary',
        columns: [
          { name: 'EmployeeID', type: 'categorical' }, { name: 'Name', type: 'text' },
          { name: 'Department', type: 'categorical' }, { name: 'Role', type: 'categorical' },
          { name: 'Salary', type: 'numeric' }, { name: 'JoinDate', type: 'temporal' },
        ],
        sampleRows: [
          ['E001', 'Anjali Verma', 'Sales', 'Manager', 65000, '2022-03-15'],
          ['E002', 'Vikram Mehta', 'Engineering', 'Developer', 72000, '2023-01-20'],
          ['E003', 'Sneha Kumar', 'HR', 'Coordinator', 45000, '2023-09-01'],
        ],
      },
    ],
  });
});

module.exports = router;
