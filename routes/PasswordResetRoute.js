import express from 'express';
import { forgotPassword, resetPassword, validateOtp} from '../controllers/PasswordController.js';
const router = express.Router();
 
router.post('/api/users/forgot-password', forgotPassword);
router.post('/api/users/validate-otp', validateOtp)
router.post('/api/users/reset-password', resetPassword);
 
// module.exports = router;
export default router;