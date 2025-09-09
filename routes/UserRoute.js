import express from 'express';
const router = express.Router();
import { createUser } from '../controllers/UserController.js';
import { getUsers } from  '../controllers/UserController.js';
import { loginUser } from '../controllers/UserController.js';
import { updateProfile } from '../controllers/UserController.js';

router.post('/api/users/signup', createUser);
router.get('/api/users', getUsers);
router.post('/api/users/login', loginUser);
router.put("/:userId/edit-profile", updateProfile);

export default router;