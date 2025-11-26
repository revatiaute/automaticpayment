// server.js - Cashfree Payment Backend (FIXED VERSION)
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Cashfree Configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_API_VERSION = '2023-08-01';

// FIXED: Proper URL structure for both environments
const CASHFREE_BASE_URL = process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// Validate credentials on startup
if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
    console.error('❌ ERROR: Cashfree credentials missing in .env file!');
    console.error('Required: CASHFREE_APP_ID and CASHFREE_SECRET_KEY');
    process.exit(1);
}

// API: Create Cashfree Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, upiId, customerName, customerPhone, customerEmail } = req.body;

        // Enhanced validation
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }

        if (!upiId || !upiId.includes('@')) {
            return res.status(400).json({ success: false, error: 'Invalid UPI ID format' });
        }

        // Generate unique order ID
        const orderId = 'ORDER_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // FIXED: Proper Cashfree Order Request structure
        const orderData = {
            order_id: orderId,
            order_amount: parseFloat(amount).toFixed(2), // FIXED: Ensure 2 decimal places
            order_currency: 'INR',
            customer_details: {
                customer_id: 'CUST_' + Date.now(),
                customer_name: customerName || 'Customer',
                customer_email: customerEmail || 'customer@example.com',
                customer_phone: customerPhone || '9999999999'
            },
            order_meta: {
                return_url: ${req.protocol}://${req.get('host')}/payment-response?order_id=${orderId},
                notify_url: ${req.protocol}://${req.get('host')}/api/webhook
                // REMOVED: payment_methods - let Cashfree handle this
            },
            order_note: Payment to ${upiId}
        };

        console.log('📤 Creating order:', orderId);
        console.log('💰 Amount:', orderData.order_amount);
        console.log('🔗 API URL:', ${CASHFREE_BASE_URL}/orders);

        // FIXED: Proper headers with correct authentication
        const response = await axios.post(
            ${CASHFREE_BASE_URL}/orders,
            orderData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-version': CASHFREE_API_VERSION,
                    'x-client-id': CASHFREE_APP_ID,
                    'x-client-secret': CASHFREE_SECRET_KEY,
                    'Accept': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log('✅ Order created successfully');

        if (response.data && response.data.payment_session_id) {
            res.json({
                success: true,
                order_id: orderId,
                payment_session_id: response.data.payment_session_id,
                order_token: response.data.order_token || response.data.payment_session_id,
                amount: amount,
                app_id: CASHFREE_APP_ID,
                environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
            });
        } else {
            throw new Error('Invalid response from Cashfree API');
        }

    } catch (error) {
        console.error('❌ Order Creation Error:');
        console.error('Status:', error.response?.status);
        console.error('Message:', error.response?.data?.message || error.message);
        console.error('Details:', JSON.stringify(error.response?.data, null, 2));

        // FIXED: Better error response
        const errorMessage = error.response?.data?.message || 
                           error.response?.data?.error?.message ||
                           error.message ||
                           'Failed to create order';

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage,
            details: error.response?.data
        });
    }
});

// API: Verify Payment Status
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { order_id } = req.body;

        if (!order_id) {
            return res.status(400).json({ success: false, error: 'Order ID required' });
        }

        console.log('🔍 Verifying payment for order:', order_id);

        // FIXED: Proper verification endpoint
        const response = await axios.get(
            ${CASHFREE_BASE_URL}/orders/${order_id},
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-version': CASHFREE_API_VERSION,
                    'x-client-id': CASHFREE_APP_ID,
                    'x-client-secret': CASHFREE_SECRET_KEY,
                    'Accept': 'application/json'
                },
                timeout: 30000
            }
        );

        const orderStatus = response.data;
        console.log('📊 Order status:', orderStatus.order_status);

        if (orderStatus.order_status === 'PAID') {
            res.json({
                success: true,
                message: 'Payment verified successfully',
                order_id: order_id,
                payment_id: orderStatus.cf_order_id,
                order_status: orderStatus.order_status,
                order_amount: orderStatus.order_amount
            });
        } else {
            res.json({
                success: false,
                message: 'Payment not completed',
                order_status: orderStatus.order_status,
                order_id: order_id
            });
        }

    } catch (error) {
        console.error('❌ Verification Error:');
        console.error('Status:', error.response?.status);
        console.error('Message:', error.response?.data?.message || error.message);

        res.status(error.response?.status || 500).json({
            success: false,
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
    }
});

// FIXED: Webhook endpoint with proper signature verification
app.post('/api/webhook', (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];

        console.log('📨 Webhook received');
        console.log('Signature:', signature);
        console.log('Timestamp:', timestamp);
        console.log('Body:', JSON.stringify(req.body, null, 2));

        // Verify webhook signature
        const signatureData = timestamp + JSON.stringify(req.body);
        const computedSignature = crypto
            .createHmac('sha256', CASHFREE_SECRET_KEY)
            .update(signatureData)
            .digest('base64');

        if (signature === computedSignature) {
            console.log('✅ Webhook verified successfully');
            
            // Process webhook data
            const { order_id, order_status, payment } = req.body.data || req.body;
            console.log(Order ${order_id}: ${order_status});
            
            // TODO: Save to database, send notifications, etc.
            
            res.json({ success: true });
        } else {
            console.error('❌ Invalid webhook signature');
            res.status(400).json({ success: false, error: 'Invalid signature' });
        }

    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Payment response handler
app.get('/payment-response', (req, res) => {
    const orderId = req.query.order_id;
    const status = req.query.status || 'pending';
    console.log(💳 Payment response: Order ${orderId} - Status: ${status});
    res.redirect(/?order_id=${orderId}&status=${status});
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        cashfree_url: CASHFREE_BASE_URL,
        credentials_loaded: !!(CASHFREE_APP_ID && CASHFREE_SECRET_KEY)
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Cashfree Payment Server Started');
    console.log('='.repeat(50));
    console.log(✅ Server URL: http://localhost:${PORT});
    console.log(🔑 App ID: ${CASHFREE_APP_ID ? '✓ Loaded' : '✗ MISSING!'});
    console.log(🔑 Secret Key: ${CASHFREE_SECRET_KEY ? '✓ Loaded' : '✗ MISSING!'});
    console.log(🌍 Environment: ${process.env.NODE_ENV === 'production' ? '🔴 PRODUCTION' : '🟡 SANDBOX'});
    console.log(🔗 Cashfree URL: ${CASHFREE_BASE_URL});
    console.log('='.repeat(50));
    console.log(\n📱 Open http://localhost:${PORT} in your browser\n);
});
