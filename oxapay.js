import fetch from 'node-fetch';
import { OXAPAY_API_KEY, OXAPAY_BASE_URL } from './config.js';

async function createInvoice(amount_usdt, order_id, callback_url = null) {
    /** Create a payment invoice via OxaPay. Returns object with payLink, trackId, qrCode etc. */
    const payload = {
        merchant: OXAPAY_API_KEY,
        amount: amount_usdt,
        currency: "USDT",
        lifeTime: 30,             // minutes
        feePaidByPayer: 1,
        underPaidCover: 2.5,
        callbackUrl: callback_url || "",
        returnUrl: "",
        description: `GTC Presale Payment - Order ${order_id}`,
        orderId: order_id,
    };
    try {
        const resp = await fetch(`${OXAPAY_BASE_URL}/merchants/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 15000
        });
        const data = await resp.json();
        if (data.result === 100) {
            return { success: true, data };
        }
        return { success: false, error: data.message || "Unknown error" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function verifyPayment(track_id) {
    /** Verify a payment by track ID. */
    const payload = {
        merchant: OXAPAY_API_KEY,
        trackId: track_id,
    };
    try {
        const resp = await fetch(`${OXAPAY_BASE_URL}/merchants/inquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 15000
        });
        const data = await resp.json();
        if (data.result === 100) {
            const status = data.status || "";
            return {
                success: true,
                paid: status === "Paid",
                status,
                data
            };
        }
        return { success: false, error: data.message || "Unknown error" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function verifyByHash(tx_hash) {
    /** Attempt to verify payment by transaction hash (manual fallback). */
    const payload = {
        merchant: OXAPAY_API_KEY,
        txHash: tx_hash,
    };
    try {
        const resp = await fetch(`${OXAPAY_BASE_URL}/merchants/inquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 15000
        });
        const data = await resp.json();
        if (data.result === 100) {
            return { success: true, paid: data.status === "Paid", data };
        }
        return { success: false, error: data.message || "Unknown error" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export { createInvoice, verifyPayment, verifyByHash };