import axios from 'axios';

// In dev, baseURL='/api' is proxied to the backend by vite.config.js.
// In production, set VITE_API_URL to the full backend URL (e.g.
// "https://datawiz-api.onrender.com/api"). The trailing /api is required
// because all backend routes are mounted under /api/*.
const API_BASE = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: API_BASE, timeout: 30000, withCredentials: true });

export const uploadFile = async (file) => {
  const fd = new FormData(); fd.append('file', file);
  return (await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
};
export const getDatasetData = async (id, page = 1, limit = 100) => (await api.get(`/upload/${id}/data`, { params: { page, limit } })).data;
export const deleteDataset = async (id) => (await api.delete(`/upload/${id}`)).data;
export const getAnalysis = async (id) => (await api.get(`/analysis/${id}`)).data;
export const getRecommendations = async (id) => (await api.get(`/analysis/${id}/recommendations`)).data;
export const getChartData = async (id, spec) => (await api.post(`/analysis/${id}/chart-data`, spec)).data;
export const queryNLP = async (id, query) => (await api.post(`/nlp/${id}/query`, { query })).data;
export const getSuggestions = async (id) => (await api.get(`/nlp/${id}/suggestions`)).data;
export const getDashboard = async (id) => (await api.get(`/dashboard/${id}`)).data;
export const getIssues = async (id) => (await api.get(`/cleaning/${id}/issues`)).data;
export const applyClean = async (id, action, column, params) => (await api.post(`/cleaning/${id}/apply`, { action, column, params })).data;
export const autoClean = async (id) => (await api.post(`/cleaning/${id}/auto-clean`)).data;
export const getDownloadUrl = (id) => `/api/cleaning/${id}/download`;

// Learning + Memory
export const sendFeedback = async (id, chartType, action, spec) => (await api.post(`/learning/${id}/feedback`, { chartType, action, spec })).data;
export const getStats = async () => (await api.get(`/learning/stats`)).data;
export const resetState = async (target = 'all') => (await api.post(`/learning/reset`, { target })).data;
export const deleteMemory = async (memId) => (await api.delete(`/learning/memory/${memId}`)).data;

// Dataset creation
export const createDataset = async (name, columns, rows) => (await api.post(`/create`, { name, columns, rows })).data;
export const getTemplates = async () => (await api.get(`/create/templates`)).data;

// Sheets (Tableau-style saved visualizations)
export const renderSheet = async (datasetId, spec) => (await api.post(`/sheets/render`, { datasetId, spec })).data;
export const listSheets = async (datasetId) => (await api.get(`/sheets`, { params: { datasetId } })).data;
export const getSheet = async (id) => (await api.get(`/sheets/${id}`)).data;
export const saveSheet = async (name, datasetId, spec) => (await api.post(`/sheets`, { name, datasetId, spec })).data;
export const updateSheet = async (id, patch) => (await api.put(`/sheets/${id}`, patch)).data;
export const deleteSheet = async (id) => (await api.delete(`/sheets/${id}`)).data;
export const validateFormula = async (formula, datasetId) => (await api.post(`/sheets/validate-formula`, { formula, datasetId })).data;
export const getFilterOptions = async (datasetId, field) => (await api.get(`/sheets/filter-options/${datasetId}/${encodeURIComponent(field)}`)).data;

// AI-Native v6.2
export const converseSheet = async (message, currentSpec, datasetId, history = []) => (await api.post(`/sheets/converse`, { message, currentSpec, datasetId, history })).data;
export const suggestCalcFields = async (datasetId) => (await api.get(`/sheets/suggest-calc-fields/${datasetId}`)).data;
export const getDashboardInsights = async (id) => (await api.get(`/dashboards/${id}/insights`)).data;
export const getAIStatus = async () => (await api.get(`/sheets/ai-status`)).data;

// Dashboards (user-arranged grids of sheets)
export const listDashboards = async (datasetId) => (await api.get(`/dashboards`, { params: { datasetId } })).data;
export const getCustomDashboard = async (id) => (await api.get(`/dashboards/${id}`)).data;
export const saveDashboard = async (name, datasetId, tiles) => (await api.post(`/dashboards`, { name, datasetId, tiles })).data;
export const updateDashboard = async (id, patch) => (await api.put(`/dashboards/${id}`, patch)).data;
export const deleteDashboard = async (id) => (await api.delete(`/dashboards/${id}`)).data;

// v6.4 — Data sources
export const listDatasets = async () => (await api.get('/upload')).data.datasets;
export const testSqlConnection = async (config) => (await api.post('/connections/sql/test', config)).data;
export const importFromSql = async (connection, query, name) => (await api.post('/connections/sql/import', { connection, query, name })).data;
export const testApiEndpoint = async (config) => (await api.post('/connections/api/test', config)).data;
export const importFromApi = async (config, name) => (await api.post('/connections/api/import', { config, name })).data;
export const unionDatasets = async (datasetIds, mode, name) => (await api.post('/connections/union', { datasetIds, mode, name })).data;
export const joinDatasets = async (params) => (await api.post('/connections/join', params)).data;
export const getConnectionCapabilities = async () => (await api.get('/connections/capabilities')).data;

// v6.6 — Auth
export const getAuthStatus = async () => (await api.get('/auth/status')).data;
export const signup = async (email, password, name) => (await api.post('/auth/signup', { email, password, name })).data;
export const login = async (email, password) => (await api.post('/auth/login', { email, password })).data;
export const loginTwoFactor = async (pendingToken, code, backupCode) => (await api.post('/auth/login/2fa', { pendingToken, code, backupCode })).data;
export const logout = async () => (await api.post('/auth/logout')).data;
export const logoutEverywhere = async () => (await api.post('/auth/logout/all')).data;
export const refreshAuth = async () => (await api.post('/auth/refresh')).data;
export const getMe = async () => (await api.get('/auth/me')).data;
export const updateMe = async (patch) => (await api.patch('/auth/me', patch)).data;
export const changePassword = async (currentPassword, newPassword) => (await api.post('/auth/change-password', { currentPassword, newPassword })).data;

// v6.7 — Email verification + password reset
export const sendVerificationEmail = async () => (await api.post('/auth/verify/send')).data;
export const confirmEmailVerification = async (token) => (await api.post('/auth/verify/confirm', { token })).data;
export const requestPasswordReset = async (email) => (await api.post('/auth/forgot', { email })).data;
export const resetPassword = async (token, newPassword) => (await api.post('/auth/reset', { token, newPassword })).data;

// v6.7 — 2FA
export const get2FAStatus = async () => (await api.get('/auth/2fa/status')).data;
export const setup2FA = async () => (await api.post('/auth/2fa/setup')).data;
export const enable2FA = async (code) => (await api.post('/auth/2fa/enable', { code })).data;
export const disable2FA = async (password) => (await api.post('/auth/2fa/disable', { password })).data;

// v6.7 — Sharing
export const listSharedWithMe = async () => (await api.get('/share/with-me')).data;
export const shareSheetWithUser = async (sheetId, email, role = 'view') => (await api.post(`/share/sheet/${sheetId}`, { email, role })).data;
export const shareDashboardWithUser = async (dashboardId, email, role = 'view') => (await api.post(`/share/dashboard/${dashboardId}`, { email, role })).data;
export const listSheetShares = async (sheetId) => (await api.get(`/share/sheet/${sheetId}/users`)).data;
export const listDashboardShares = async (dashboardId) => (await api.get(`/share/dashboard/${dashboardId}/users`)).data;
export const revokeSheetShare = async (sheetId, userId) => (await api.delete(`/share/sheet/${sheetId}/users/${userId}`)).data;
export const revokeDashboardShare = async (dashboardId, userId) => (await api.delete(`/share/dashboard/${dashboardId}/users/${userId}`)).data;
export const createSheetShareLink = async (sheetId, expiresAt = null) => (await api.post(`/share/sheet/${sheetId}/link`, { expiresAt })).data;
export const createDashboardShareLink = async (dashboardId, expiresAt = null) => (await api.post(`/share/dashboard/${dashboardId}/link`, { expiresAt })).data;
export const revokeShareLink = async (linkId) => (await api.delete(`/share/links/${linkId}`)).data;

// v6.11 — Automated visualization
export const generateAutoDashboard = async (datasetId) =>
  (await api.post(`/auto/dashboard/${datasetId}`)).data;
export const exploreDataset = async (datasetId, opts = {}) =>
  (await api.post(`/auto/explore/${datasetId}`, opts)).data;
export const saveFindingAsSheet = async (datasetId, finding) =>
  (await api.post(`/auto/explore/${datasetId}/save-finding`, { finding })).data;

// v6.14 — Key driver analysis
export const analyzeDrivers = async (datasetId, target, opts = {}) =>
  (await api.post(`/auto/drivers/${datasetId}`, { target, ...opts })).data;

// v6.17 — Annotations
export const listAnnotations = async (sheetId) =>
  (await api.get(`/annotations/sheet/${sheetId}`)).data.annotations;
export const createAnnotation = async (data) =>
  (await api.post(`/annotations`, data)).data.annotation;
export const updateAnnotation = async (id, patch) =>
  (await api.patch(`/annotations/${id}`, patch)).data.annotation;
export const deleteAnnotation = async (id) =>
  (await api.delete(`/annotations/${id}`)).data;

// v6.17 — Decomposition tree
export const decompRoot = async (datasetId, body) =>
  (await api.post(`/auto/decomp/${datasetId}/root`, body)).data;
export const decompExpand = async (datasetId, body) =>
  (await api.post(`/auto/decomp/${datasetId}/expand`, body)).data;

// v6.17 — Scheduled reports
export const listReports = async () => (await api.get(`/reports`)).data.reports;
export const createReport = async (body) => (await api.post(`/reports`, body)).data.report;
export const updateReport = async (id, patch) => (await api.patch(`/reports/${id}`, patch)).data.report;
export const deleteReport = async (id) => (await api.delete(`/reports/${id}`)).data;
export const testReport = async (id) => (await api.post(`/reports/${id}/test`)).data;

export default api;
