const crypto = require('node:crypto');
const { appendOrderLead, hasApprovedPaymentLog, hasSuccessfulEmailLog } = require('../lib/github-order-log');
const { sendPurchaseApprovedEmail } = require('../lib/email-delivery');
const { registerCouponUsage } = require('../lib/coupon-utils');

const PAYMENT_API_BASE = 'https://api.mercadopago.com/v1/payments';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function getFirst(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getNotificationType(req, body) {
  return getFirst(req.query?.type)
    || getFirst(req.query?.topic)
    || body.type
    || (typeof body.action === 'string' ? body.action.split('.')[0] : '')
    || '';
}

function getResourceId(req, body) {
  return String(
    getFirst(req.query?.['data.id'])
    || getFirst(req.query?.id)
    || body?.data?.id
    || body?.id
    || ''
  ).trim();
}

function parseSignatureHeader(headerValue) {
  return String(headerValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key] = value;
      return acc;
    }, {});
}

function safeCompare(a, b) {
  const aBuffer = Buffer.from(String(a || ''), 'utf8');
  const bBuffer = Buffer.from(String(b || ''), 'utf8');
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isSignatureValid(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    return { valid: true, reason: 'secret_not_configured' };
  }

  const signature = parseSignatureHeader(req.headers['x-signature']);
  const requestId = String(req.headers['x-request-id'] || '').trim();
  const ts = String(signature.ts || '').trim();
  const hash = String(signature.v1 || '').trim().toLowerCase();

  if (!dataId || !requestId || !ts || !hash) {
    return { valid: false, reason: 'missing_signature_parts' };
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  return {
    valid: safeCompare(expected, hash),
    reason: 'validated'
  };
}

async function fetchPayment(paymentId) {
  const response = await fetch(`${PAYMENT_API_BASE}/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || 'Mercado Pago não retornou os detalhes do pagamento.');
  }

  return data;
}

function normalizePayment(payment) {
  return {
    id: payment.id,
    date_created: payment.date_created,
    date_approved: payment.date_approved,
    status: payment.status,
    status_detail: payment.status_detail,
    payment_type_id: payment.payment_type_id,
    transaction_amount: payment.transaction_amount,
    transaction_amount_refunded: payment.transaction_amount_refunded,
    description: payment.description,
    external_reference: payment.external_reference,
    payer: {
      email: payment.payer?.email || '',
      first_name: payment.payer?.first_name || '',
      last_name: payment.payer?.last_name || ''
    },
    metadata: payment.metadata || {}
  };
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, endpoint: 'mercado-pago-webhook' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado na Vercel.' });
  }

  try {
    const body = parseBody(req);
    const notificationType = getNotificationType(req, body);
    const resourceId = getResourceId(req, body);

    if (!notificationType) {
      return res.status(400).json({ error: 'Tipo de notificação ausente.' });
    }

    if (notificationType !== 'payment') {
      return res.status(200).json({ ok: true, ignored: true, notificationType });
    }

    if (!resourceId) {
      return res.status(400).json({ error: 'ID do pagamento ausente.' });
    }

    const signature = isSignatureValid(req, resourceId);
    if (!signature.valid) {
      return res.status(401).json({ error: 'Assinatura inválida.', reason: signature.reason });
    }

    const payment = await fetchPayment(resourceId);
    const normalizedPayment = normalizePayment(payment);

    const shouldSkipApprovedLog = normalizedPayment.status === 'approved'
      && await hasApprovedPaymentLog(normalizedPayment.id);

    if (!shouldSkipApprovedLog) {
      await appendOrderLead({
        created_at: new Date().toISOString(),
        status: normalizedPayment.status,
        status_detail: normalizedPayment.status_detail,
        payment_id: normalizedPayment.id,
        payment_type_id: normalizedPayment.payment_type_id,
        transaction_amount: normalizedPayment.transaction_amount,
        payer_email: normalizedPayment.payer?.email || '',
        customer_name: normalizedPayment.metadata?.customer_name || '',
        customer_email: normalizedPayment.metadata?.customer_email || normalizedPayment.payer?.email || '',
        customer_phone: normalizedPayment.metadata?.customer_phone || '',
        customer_access_code: normalizedPayment.metadata?.customer_access_code || '',
        coupon_code: normalizedPayment.metadata?.coupon_code || '',
        items: Array.isArray(normalizedPayment.metadata?.original_items) ? normalizedPayment.metadata.original_items : []
      });
    }

    let email = { sent: false, skipped: true, reason: 'payment_not_approved' };
    if (normalizedPayment.status === 'approved') {
      const couponCode = normalizedPayment.metadata?.coupon_code || '';
      if (couponCode) {
        try {
          await registerCouponUsage(couponCode, normalizedPayment.id);
        } catch (couponError) {
          console.error('[coupon-usage]', couponError);
        }
      }
      const alreadySent = await hasSuccessfulEmailLog(normalizedPayment.id);
      if (alreadySent) {
        email = { sent: false, skipped: true, reason: 'already_sent' };
      } else {
        try {
          email = await sendPurchaseApprovedEmail(normalizedPayment);
          if (email.sent) {
            await appendOrderLead({
              created_at: new Date().toISOString(),
              event: 'email_sent',
              payment_id: normalizedPayment.id,
              customer_email: normalizedPayment.metadata?.customer_email || normalizedPayment.payer?.email || '',
              customer_name: normalizedPayment.metadata?.customer_name || '',
              customer_access_code: normalizedPayment.metadata?.customer_access_code || '',
              resend_email_id: email.id || '',
              delivery_url: email.delivery_url || ''
            });
          }
        } catch (emailError) {
          email = {
            sent: false,
            skipped: false,
            reason: emailError.message || 'email_send_failed'
          };
          await appendOrderLead({
            created_at: new Date().toISOString(),
            event: 'email_error',
            payment_id: normalizedPayment.id,
            customer_email: normalizedPayment.metadata?.customer_email || normalizedPayment.payer?.email || '',
            customer_name: normalizedPayment.metadata?.customer_name || '',
            error: email.reason
          });
          console.error('[purchase-email]', emailError);
        }
      }
    }

    console.log(JSON.stringify({
      source: 'mercado-pago-webhook',
      received_at: new Date().toISOString(),
      notificationType,
      resourceId,
      signature,
      payment: normalizedPayment,
      email
    }));

    return res.status(200).json({
      ok: true,
      notificationType,
      payment: normalizedPayment,
      email
    });
  } catch (error) {
    console.error('[mercado-pago-webhook]', error);
    return res.status(500).json({ error: error.message || 'Erro ao processar webhook.' });
  }
};
