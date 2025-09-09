import express from 'express';
import { getUserAddresses } from '../controllers/AddressController.js';
import { addUserAddress } from '../controllers/AddressController.js';

const router = express.Router();

router.get('/api/users/:userId/addresses', getUserAddresses);
router.post('/api/users/addresses/add/:userId', addUserAddress);

export default router;