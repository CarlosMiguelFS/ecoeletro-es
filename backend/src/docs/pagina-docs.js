// Swagger via CDN. O jeito "normal" (swagger-ui-express) usa express.static,
// e o Vercel ignora express.static. Então fomos de CDN e ficou até mais leve.
const VERSAO_SWAGGER_UI = '5';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSAO_SWAGGER_UI}`;

export const paginaDocs = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EcoEletro ES | API</title>
    <link rel="stylesheet" href="${CDN}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${CDN}/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', persistAuthorization: true });
    </script>
  </body>
</html>`;
