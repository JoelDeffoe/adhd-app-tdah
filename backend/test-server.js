// Simple test server to verify basic functionality
const express = require('express');
const app = express();
const PORT = 3001; // Use different port to avoid conflicts

app.get('/', (req, res) => {
  res.json({ message: 'Test server is working!', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', port: PORT });
});

app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Visit: http://localhost:${PORT}`);
});