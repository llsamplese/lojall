const DOWNLOAD_LINKS = require("../data/download-links");

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[â€“â€”]/g, "-")
    .replace(/[`"'_*]+/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const normalizedDownloads = Object.entries(DOWNLOAD_LINKS).reduce((acc, [name, link]) => {
  acc[normalizeName(name)] = link;
  return acc;
}, {});

function getSiteBaseUrl() {
  const explicit = String(process.env.SITE_BASE_URL || "").trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const successUrl = String(process.env.MP_SUCCESS_URL || "").trim();
  if (successUrl) {
    return successUrl.replace(/\/sucesso\.html.*$/i, "").replace(/\/+$/, "");
  }

  return "https://llsamples.com";
}

function buildDeliveryUrl(paymentId) {
  return `${getSiteBaseUrl()}/sucesso.html?payment_id=${encodeURIComponent(paymentId)}`;
}

function buildDeliveredItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const title = String(item?.title || "").trim();
    const unitPrice = Number(item?.unit_price || 0);
    const quantity = Number(item?.quantity || 1);
    const link = normalizedDownloads[normalizeName(title)] || "";
    return {
      title,
      unit_price: unitPrice,
      quantity,
      link,
      delivered: Boolean(link)
    };
  });
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function buildEmailPayload(payment) {
  const customerEmail = String(payment?.metadata?.customer_email || payment?.payer?.email || "").trim();
  if (!customerEmail) {
    return null;
  }

  const items = buildDeliveredItems(payment?.metadata?.original_items);
  const deliveredItems = items.filter((item) => item.delivered);
  const accessCode = String(payment?.metadata?.customer_access_code || "").trim();
  const customerName = String(payment?.metadata?.customer_name || "").trim() || "cliente";
  const transactionAmount = Number(payment?.transaction_amount || 0);
  const paymentId = String(payment?.id || "").trim();
  const deliveryUrl = buildDeliveryUrl(paymentId);
  const paymentLabel = payment?.payment_type_id === "pix"
    ? "Pix"
    : payment?.payment_type_id === "credit_card"
      ? "Cartão"
      : payment?.payment_type_id === "paypal"
        ? "PayPal"
        : (String(payment?.payment_type_id || "").trim() || "Pagamento");

  const itemsHtml = items.length
    ? items.map((item) => `
        <li style="margin:0 0 12px;padding:0 0 12px;border-bottom:1px solid #2a2a2a;">
          <div style="font-weight:700;color:#f7edd0;">${escapeHtml(item.title)}</div>
          <div style="color:#bca86c;font-size:14px;">${formatCurrency(item.unit_price)}${item.quantity > 1 ? ` x ${item.quantity}` : ""}</div>
          ${item.delivered ? `<div style="margin-top:8px;"><a href="${escapeHtml(item.link)}" style="color:#0b0b0b;background:#ffc83d;padding:10px 14px;border-radius:12px;text-decoration:none;font-weight:700;display:inline-block;">Abrir download</a></div>` : `<div style="margin-top:8px;color:#ffcfbf;">Link ainda não cadastrado para este item.</div>`}
        </li>
      `).join("")
    : `<li style="color:#bca86c;">Nenhum item foi encontrado nesse pedido.</li>`;

  const textItems = items.length
    ? items.map((item) => `- ${item.title} (${formatCurrency(item.unit_price)})${item.delivered ? `\n  Download: ${item.link}` : "\n  Download: link ainda não cadastrado"}`).join("\n")
    : "- Nenhum item encontrado";

  return {
    to: customerEmail,
    subject: `Compra aprovada - Loja LL Samples`,
    html: `
      <div style="background:#090909;padding:32px 18px;font-family:Inter,Arial,sans-serif;color:#f5edd2;">
        <div style="max-width:640px;margin:0 auto;background:#121212;border:1px solid #2a2415;border-radius:24px;overflow:hidden;">
          <div style="padding:24px 24px 8px;">
            <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#c3a85f;">Loja LL Samples</div>
            <h1 style="margin:10px 0 6px;font-size:30px;line-height:1.1;color:#fff4cf;">Pagamento aprovado</h1>
            <p style="margin:0;color:#c9b37a;font-size:16px;">Olá, ${escapeHtml(customerName)}. Sua compra foi confirmada e já está pronta para consulta.</p>
          </div>
          <div style="padding:24px;">
            <div style="background:#171717;border:1px solid #2a2a2a;border-radius:18px;padding:18px;margin-bottom:18px;">
              <div style="display:grid;gap:8px;color:#f3e7be;">
                <div><strong>Pagamento:</strong> ${escapeHtml(paymentLabel)}</div>
                <div><strong>Total:</strong> ${formatCurrency(transactionAmount)}</div>
                ${accessCode ? `<div><strong>Código de acesso:</strong> ${escapeHtml(accessCode)}</div>` : ""}
                ${paymentId ? `<div><strong>Payment ID:</strong> ${escapeHtml(paymentId)}</div>` : ""}
              </div>
            </div>
            <div style="margin:0 0 16px;">
              <a href="${escapeHtml(deliveryUrl)}" style="display:inline-block;background:#ffc83d;color:#111;padding:14px 18px;border-radius:14px;text-decoration:none;font-weight:800;">Abrir entrega da compra</a>
            </div>
            <div style="background:#171717;border:1px solid #2a2a2a;border-radius:18px;padding:18px;">
              <div style="font-size:18px;font-weight:800;color:#fff3cb;margin-bottom:14px;">Itens do pedido</div>
              <ul style="list-style:none;margin:0;padding:0;">
                ${itemsHtml}
              </ul>
            </div>
            <p style="margin:18px 0 0;color:#a7925d;font-size:13px;line-height:1.6;">Se o botão acima não abrir, use este link: <br><a href="${escapeHtml(deliveryUrl)}" style="color:#ffd56a;">${escapeHtml(deliveryUrl)}</a></p>
          </div>
        </div>
      </div>
    `,
    text: `Loja LL Samples\n\nPagamento aprovado.\n\nCliente: ${customerName}\nPagamento: ${paymentLabel}\nTotal: ${formatCurrency(transactionAmount)}\n${accessCode ? `Código de acesso: ${accessCode}\n` : ""}${paymentId ? `Payment ID: ${paymentId}\n` : ""}\nAbrir entrega: ${deliveryUrl}\n\nItens:\n${textItems}\n`
  };
}

async function sendPurchaseApprovedEmail(payment) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) {
    return { sent: false, skipped: true, reason: "resend_not_configured" };
  }

  const payload = buildEmailPayload(payment);
  if (!payload?.to) {
    return { sent: false, skipped: true, reason: "missing_customer_email" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Resend não conseguiu enviar o e-mail.");
  }

  return {
    sent: true,
    id: data?.id || "",
    to: payload.to,
    subject: payload.subject,
    delivery_url: buildDeliveryUrl(payment?.id || "")
  };
}

module.exports = {
  buildDeliveredItems,
  buildDeliveryUrl,
  buildEmailPayload,
  sendPurchaseApprovedEmail
};
