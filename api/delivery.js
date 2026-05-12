const DOWNLOAD_LINKS = require('../data/download-links');
const { getAllOrderRecords } = require('../lib/github-order-log');

const PAYMENT_API_BASE = 'https://api.mercadopago.com/v1/payments';

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[â€“â€”]/g, '-')
    .replace(/[`"'_*]+/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const normalizedDownloads = Object.entries(DOWNLOAD_LINKS).reduce((acc, [name, link]) => {
  acc[normalizeName(name)] = link;
  return acc;
}, {});

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
    throw new Error(data?.message || 'Nao foi possivel consultar o pagamento no Mercado Pago.');
  }

  return data;
}

function getPaymentId(req) {
  return String(req.query?.payment_id || req.query?.collection_id || '').trim();
}

function buildDeliveries(purchasedItems) {
  return (Array.isArray(purchasedItems) ? purchasedItems : []).map((item) => {
    const title = String(item.title || '').trim();
    const link = normalizedDownloads[normalizeName(title)] || '';
    return {
      title,
      unit_price: item.unit_price,
      quantity: Number(item.quantity || 1),
      link,
      delivered: Boolean(link)
    };
  });
}

async function findPaypalPayment(paymentId) {
  const target = String(paymentId || '').trim();
  if (!target) return null;

  const records = await getAllOrderRecords();
  return records
    .slice()
    .reverse()
    .find((record) =>
      String(record?.payment_id || '').trim() === target
      && String(record?.status || '').trim() === 'approved'
    ) || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const paymentId = getPaymentId(req);
    if (!paymentId) {
      return res.status(400).json({ error: 'payment_id e obrigatorio.' });
    }

    if (paymentId.startsWith('paypal-')) {
      const payment = await findPaypalPayment(paymentId);
      if (!payment) {
        return res.status(409).json({
          approved: false,
          payment_id: paymentId,
          status: 'pending',
          status_detail: 'paypal_log_not_found',
          items: []
        });
      }

      const deliveries = buildDeliveries(payment.items);
      const missing = deliveries.filter((item) => !item.delivered).map((item) => item.title);

      return res.status(200).json({
        approved: true,
        payment_id: payment.payment_id,
        date_approved: payment.created_at,
        payment_type_id: payment.payment_type_id || 'paypal',
        transaction_amount: payment.transaction_amount,
        external_reference: payment.paypal_order_id || '',
        items: deliveries,
        missing
      });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'MP_ACCESS_TOKEN nao configurado na Vercel.' });
    }

    const payment = await fetchPayment(paymentId);
    const purchasedItems = Array.isArray(payment?.metadata?.original_items) ? payment.metadata.original_items : [];

    if (payment.status !== 'approved') {
      return res.status(409).json({
        approved: false,
        payment_id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        items: purchasedItems.map((item) => ({
          title: item.title,
          unit_price: item.unit_price,
          quantity: Number(item.quantity || 1)
        }))
      });
    }

    const deliveries = buildDeliveries(purchasedItems);
    const missing = deliveries.filter((item) => !item.delivered).map((item) => item.title);

    return res.status(200).json({
      approved: true,
      payment_id: payment.id,
      date_approved: payment.date_approved,
      payment_type_id: payment.payment_type_id,
      transaction_amount: payment.transaction_amount,
      external_reference: payment.external_reference,
      items: deliveries,
      missing
    });
  } catch (error) {
    console.error('[delivery]', error);
    return res.status(500).json({ error: error.message || 'Erro ao gerar entrega.' });
  }
};
