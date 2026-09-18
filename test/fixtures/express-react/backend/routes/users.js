const express = require('express');
const { protect, authorize } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

router.use(protect);

router.get('/', listUsers);
router.post('/', authorize('admin'), validate, createUser);
router.delete('/:id', authorize('admin'), deleteUser);

module.exports = router;

function listUsers(req, res) {}
function createUser(req, res) {}
function deleteUser(req, res) {}
