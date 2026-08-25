const express = require('express');
const app = express();
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.status(500).json({ error: 'test' });
});
app.listen(3001, () => console.log('started'));
