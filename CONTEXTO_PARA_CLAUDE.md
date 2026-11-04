# Contexto técnico para revisar com Claude

Este projeto é um protótipo independente em RELATÓRIO MARCOS. Objetivo: site administrativo simples, profissional, legível e confiável. Evitar texto de preenchimento, excesso de decoração, tema escuro, neon e dependências desnecessárias.

## Acesso do protótipo

O login temporário está fixo no backend:
- Usuário: Master
- Senha: 123

Não usar .env, REPORT_PASSWORD ou REPORT_SESSION_SECRET neste protótipo. O usuário pediu autenticação real mais tarde. Até lá, manter o login genérico simples. Não confundir o cookie de sessão com um sistema de autenticação seguro.

## Fonte de dados

A fonte é a API do Google Apps Script configurada em lib/source.js, que retorna a planilha VALIDAÇÃO VAGAS JUL/DEZ. O retorno tem 68 colunas detectadas no arquivo de origem, mas entrega uma matriz com cabeçalho e 15 campos principais. lib/report-data.js localiza campos pelo texto do cabeçalho, não por posições fixas.

## Proteção dos dados

O backend não envia os campos nome ou Nome completo do colaborador ao navegador. Não adicionar esses campos ao objeto entregue pela API ou ao CSV sem decisão explícita.

A URL atual do Google Apps Script respondeu diretamente com a tabela incluindo nomes. O login temporário Master/123 não protege a URL original do Apps Script. Não disponibilizar externamente até trocar a autenticação e restringir a fonte. Nunca colocar segredo de acesso ao Apps Script no frontend.

## Unidades

A lista oficial está em lib/units.js e veio do cadastro UNIDADES_FADELITO do projeto do mapa. A exportação consultada em 04/11/2026 foi reconciliada:

- 741 registros preenchidos e úteis; uma linha de preenchimento vazia foi descartada.
- 733 associados ao cadastro oficial.
- Campinas: 6, fora do mapa de SP, mas mantidos no total.
- Guarulhos: 1, não consta no cadastro consultado; manter como revisão.
- Global: 1, categoria não-unidade.

A soma precisa continuar fechando. Não descartar linhas desconhecidas nem atribuir por semelhança.

## Métricas

- Status Aprovado: aprovada.
- Status Cancelada: cancelada, fora do número principal.
- Triagem, Briefing e Vivência: em andamento.
- Dias: tempo de fechamento; calcular média e mediana apenas para aprovadas com valor.
- Total Vivências: somar literalmente e identificar no painel como campo da planilha. Não afirmar que representa candidatos encaminhados sem confirmação humana.

## Datas e atualização

O período usa Data de abertura. Data inválida pode usar Carimbo de data/hora como alternativa; isso deve continuar sinalizado. Não corrigir silenciosamente anos impossíveis como 0026. A API renova em até 5 minutos e o navegador tenta atualizar a cada 5 minutos. Falha deve aparecer como dado antigo ou indisponível, nunca como atualização bem-sucedida.

## Arquitetura

- api/: funções Vercel (login, sessão, logout, dados).
- lib/: autenticação, fonte, validação e mapeamento.
- index.html, styles.css, app.js: front-end.
- server.js: servidor local Node sem dependência externa.
- tests/: testes automatizados com node --test.

Preservar reconciliação de contagens, separação de grupos de unidade, filtros compartilhados e exclusão de nomes.
