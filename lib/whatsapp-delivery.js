const { buildDeliveryUrl } = require("./email-delivery");

const WHATSAPP_API_VERSION = "v25.0";
const DEFAULT_PHONE_NUMBER_ID = "1165123756677941";
const DEFAULT_TEMPLATE_NAME = "confirmacao_compra_suporte";
const DEFAULT_TEMPLATE_LANG = "pt_BR";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeWhatsappPhone(value) {
  let digits = onlyDigits(value);
  if (!digits) return "";

  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }

  return digits;
}

function isValidWhatsappPhone(value) {
  const digits = normalizeWhatsappPhone(value);
  return /^55\d{10,11}$/.test(digits);
}

function getWhatsappEnv() {
  return {
    token: String(process.env.WHATSAPP_TOKEN || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || DEFAULT_PHONE_NUMBER_ID).trim(),
    templateName: String(process.env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME).trim(),
    templateLang: String(process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_TEMPLATE_LANG).trim()
  };
}

function buildTemplatePayload({ nome, telefone, produto, link }) {
  const phone = normalizeWhatsappPhone(telefone);
  if (!isValidWhatsappPhone(phone)) {
    throw new Error("Telefone de WhatsApp ausente ou invalido.");
  }

  const env = getWhatsappEnv();
  if (!env.token || !env.phoneNumberId || !env.templateName || !env.templateLang) {
    return { skipped: true, reason: "whatsapp_not_configured" };
  }

  return {
    skipped: false,
    endpoint: `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${encodeURIComponent(env.phoneNumberId)}/messages`,
    token: env.token,
    body: {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: env.templateName,
        language: { code: env.templateLang },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(nome || "cliente").trim() || "cliente" },
              { type: "text", text: String(produto || "Compra LL Samples").trim() || "Compra LL Samples" },
              { type: "text", text: String(link || "").trim() }
            ]
          }
        ]
      }
    }
  };
}

async function enviarWhatsappConfirmacaoCompra({ nome, telefone, produto, link }) {
  const payload = buildTemplatePayload({ nome, telefone, produto, link });
  if (payload.skipped) {
    console.log("[whatsapp-confirmation]", payload);
    return { sent: false, skipped: true, reason: payload.reason };
  }

  const response = await fetch(payload.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${payload.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload.body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "WhatsApp Cloud API nao enviou a mensagem.");
  }

  const messageId = data?.messages?.[0]?.id || "";
  console.log("[whatsapp-confirmation]", {
    sent: true,
    to: payload.body.to,
    template: payload.body.template.name,
    message_id: messageId
  });

  return {
    sent: true,
    id: messageId,
    to: payload.body.to,
    template: payload.body.template.name
  };
}

function buildWhatsappConfirmationFromPayment(payment) {
  const items = Array.isArray(payment?.metadata?.original_items) ? payment.metadata.original_items : [];
  const titles = items.map((item) => String(item?.title || "").trim()).filter(Boolean);
  const productLabel = titles.length === 1
    ? titles[0]
    : `${titles.length || 1} samples LL Samples`;

  return {
    nome: String(payment?.metadata?.customer_name || "").trim() || "cliente",
    telefone: String(payment?.metadata?.customer_phone || "").trim(),
    produto: productLabel,
    link: buildDeliveryUrl(payment?.id || "")
  };
}

module.exports = {
  buildWhatsappConfirmationFromPayment,
  enviarWhatsappConfirmacaoCompra,
  isValidWhatsappPhone,
  normalizeWhatsappPhone
};
