'use strict';
/** Entry point: starts the HTTP server (`npm start`). */
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;

createApp().listen(PORT, () => {
  console.log(`Apartment Management running at http://localhost:${PORT}`);
});
