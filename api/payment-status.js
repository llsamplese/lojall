const PAYMENT_API_BASE = 'https://api.mercadopago.com/v1/payments';

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
    throw new Error(data?.message || 'Não foi possível consultar o pagamento no Mercado Pago.');
  }

  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado na Vercel.' });
  }

  try {
    const paymentId = String(req.query?.payment_id || req.query?.collection_id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ error: 'payment_id é obrigatório.' });
    }

    const payment = await fetchPayment(paymentId);
    return res.status(200).json({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      payment_type_id: payment.payment_type_id,
      transaction_amount: payment.transaction_amount,
      date_approved: payment.date_approved
    });
  } catch (error) {
    console.error('[payment-status]', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar status do pagamento.' });
  }
};
