'use strict';

const path = require('path');
const express = require('express');

require('./src/db'); // init DB
const adminRouter = require('./src/routes/admin');
const agentRouter = require('./src/routes/agent');
const filesRouter = require('./src/routes/files');
const mockRouter = require('./src/routes/mock');

const app = express();
const PORT = process.env.PORT || 3421;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Static admin UI
app.use(express.static(path.join(__dirname, 'src', 'public')));

// Admin REST API
app.use('/admin/api', adminRouter);

// Agent API
app.use('/agent', agentRouter);

// Files API
app.use('/files', filesRouter);

// Catch-all mock dispatcher (must be last)
app.use(mockRouter);

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, message: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`\n  agent-api-test running`);
  console.log(`  Admin UI : http://localhost:${PORT}/`);
  console.log(`  Admin API: http://localhost:${PORT}/admin/api/configs`);
  console.log(`  Mock APIs: registered dynamically from DB\n`);
});
