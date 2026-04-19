# LL Samples + Mercado Pago na Vercel

Projeto preparado para rodar como catálogo estático + funções serverless na Vercel.

## Estrutura

- `index.html`: catálogo principal com seleção de samples e checkout transparente com Payment Brick.
- `api/process-payment.js`: processa Pix ou cartão dentro do site, recalculando total e cupom no backend.
- `api/payment-config.js`: entrega a `MP_PUBLIC_KEY` para inicializar o Payment Brick no navegador.
- `api/validate-coupon.js`: valida cupons antes do pagamento.
- `api/webhook.js`: recebe notificações de pagamento e consulta o status real na API do Mercado Pago.
- `sucesso.html`, `pendente.html`, `falha.html`: páginas de retorno do checkout.
- `.env.example`: variáveis que precisam ser cadastradas na Vercel.

## Variáveis na Vercel

Cadastre em `Settings > Environment Variables`:

- `MP_PUBLIC_KEY`
- `MP_ACCESS_TOKEN`
- `MP_SUCCESS_URL`
- `MP_PENDING_URL`
- `MP_FAILURE_URL`
- `MP_NOTIFICATION_URL`
- `MP_WEBHOOK_SECRET` (opcional, mas recomendado)
- `RESEND_API_KEY` (para envio automático de e-mail após pagamento aprovado)
- `EMAIL_FROM` (ex.: `LL Samples <entrega@llsamples.com>`)
- `SITE_BASE_URL` (ex.: `https://llsamples.com`)

## Webhook

Use como URL de notificação:

- `https://seu-dominio.vercel.app/api/webhook`

Quando a notificação for do tipo `payment`, o backend:

1. valida a assinatura se `MP_WEBHOOK_SECRET` estiver configurado;
2. consulta `GET /v1/payments/{id}` no Mercado Pago;
3. registra no log da Vercel/GitHub um JSON normalizado com status, valor, payer e metadata;
4. quando o pagamento chega como `approved`, envia o e-mail de compra automaticamente via Resend.

## Próximo passo para entrega automática

O webhook já confirma o status real do pagamento. Para liberar links automaticamente, o próximo passo é conectar esse webhook a uma camada de persistência/entrega segura.
