const express = require('express');
const userRoutes = require('./routes/users');

const app = express();
app.use('/api/users', userRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

function notFoundHandler(req, res) {}
function errorHandler(err, req, res, next) {}
