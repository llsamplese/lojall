const PAYPAL_API = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com"
};

function getPaypalEnv() {
  return String(process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

function getPaypalBaseUrl() {
  return PAYPAL_API[getPaypalEnv()];
}

function isPaypalConfigured() {
  return Boolean(String(process.env.PAYPAL_CLIENT_ID || "").trim() && String(process.env.PAYPAL_CLIENT_SECRET || "").trim());
}

async function getPaypalAccessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!clientId || !secret) {
    throw new Error("Credenciais do PayPal não configuradas.");
  }

  const credentials = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const response = await fetch(`${getPaypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.message || "PayPal não autorizou as credenciais.");
  }

  return data.access_token;
}

async function paypalRequest(path, options = {}) {
  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`${getPaypalBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.details?.[0]?.description || "PayPal rejeitou a operação.");
  }

  return data;
}

module.exports = {
  getPaypalEnv,
  isPaypalConfigured,
  paypalRequest
};
