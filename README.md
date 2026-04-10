# LL Samples + Mercado Pago na Vercel

Projeto preparado para rodar como catálogo estático + função serverless na Vercel.

## Estrutura

- `index.html`: catálogo principal com seleção de samples e checkout Mercado Pago.
- `api/create-preference.js`: cria a preferência no Mercado Pago sem expor o token no navegador.
- `sucesso.html`, `pendente.html`, `falha.html`: páginas de retorno do checkout.
- `.env.example`: variáveis que precisam ser cadastradas na Vercel.
- `vercel.json`: configuração da função serverless.

## Como publicar

1. Suba esta pasta para um repositório no GitHub.
2. Importe o repositório na Vercel.
3. Em `Settings > Environment Variables`, cadastre:
   - `MP_ACCESS_TOKEN`
   - `MP_SUCCESS_URL`
   - `MP_PENDING_URL`
   - `MP_FAILURE_URL`
   - `MP_NOTIFICATION_URL` (opcional)
4. Faça o deploy.

## Como o checkout funciona

- `Pagar com PIX`: usa a soma dos items selecionados.
- `Pagar com Cartão`: usa a soma com acréscimo de `5,24%`.
- O backend cria uma preferência com o total final e guarda os items originais em `metadata`.
- O navegador salva um resumo local do último checkout para exibir na página `sucesso.html`.

## Limite importante desta versão

- Os links de download não foram embutidos no frontend, porque isso deixaria os arquivos expostos no código-fonte.
- Se você quiser liberar downloads automaticamente só após pagamento aprovado, o próximo passo é integrar webhook + backend de entrega.
