# Relatório Administrativo — Fadelito

Site independente para consultar indicadores de vagas. Não altera a planilha original, o Ghost ou o Mapa Fadelito.

## Acesso temporário do protótipo

- Usuário: Master
- Senha: 123

O acesso está definido no backend em lib/auth.js. Não existe arquivo .env nem configuração de credenciais. Este login é somente provisório para demonstração e testes; qualquer pessoa que conheça ou inspecione o código poderá descobrir a combinação. Substituir por autenticação apropriada antes de disponibilizar publicamente.

## Iniciar localmente

1. Tenha Node.js 20 ou superior instalado.
2. Execute INICIAR RELATORIO.bat.
3. O navegador abrirá em http://127.0.0.1:3470.
4. Entre com Master / 123.

Também é possível executar npm start.

## Publicação e dados

A estrutura do Vercel está preparada, mas NÃO publicar este protótipo em acesso externo ainda.

Há dois motivos:
- O login Master / 123 é fixo no código e não é um sistema seguro.
- A URL atual do Google Apps Script respondeu diretamente com a tabela incluindo nomes. A senha do relatório não protege a fonte original.

Antes de liberar o site para outras pessoas, implementar autenticação adequada e restringir a fonte do Apps Script para chamadas autorizadas do backend. Não basta esconder a URL no frontend.

## Atualização e tolerância a falhas

- A API consulta o Google Apps Script no servidor, nunca diretamente pelo navegador.
- A leitura é renovada em intervalos de até 5 minutos por instância; o site também tenta atualizar automaticamente a cada 5 minutos.
- O botão Atualizar força uma nova leitura.
- A última leitura válida fica em memória na instância enquanto ela estiver ativa. Se a fonte falhar depois de uma leitura bem-sucedida, o painel sinaliza que os dados são antigos.
- Em uma instância fria do Vercel, se o Google estiver indisponível, o painel mostra erro em vez de inventar dados. Este protótipo não grava snapshots históricos nem depende de banco pago.
- Se o cabeçalho obrigatório mudar, a atualização falha explicitamente.

## Integridade das unidades — conferência em 04/11/2026

A exportação consultada tinha 742 linhas de dados, das quais 741 são registros preenchidos e úteis. Uma linha contendo apenas espaços foi descartada pelo relatório:

- 733 registros associados ao cadastro oficial de unidades.
- 6 registros de Campinas mantidos nos totais e identificados como fora do mapa de SP.
- 1 registro de Guarulhos mantido como cadastro a revisar; não foi associado por aproximação.
- 1 registro Global separado como não unidade.

A soma dos grupos é 741. Variações como Chacara Klabin → Klabin, Paraiso → Paraíso, Santo Andre → Santo André e Vila Sonia → Vila Sônia são normalizadas. Novas grafias desconhecidas não são corrigidas automaticamente: aparecem na conferência para revisão.

## Regras dos indicadores

- Aprovado é contado como vaga aprovada.
- Cancelada fica em indicador separado e não entra na contagem principal.
- Triagem, Briefing e Vivência são exibidos como etapas em andamento.
- Status desconhecidos e vazios ficam na auditoria e não entram no total principal até serem classificados.
- Tempo médio e mediana usam apenas registros Aprovados com Dias preenchido.
- O período usa Data de abertura; se a data estiver inválida, o carimbo é usado como alternativa e a ocorrência é sinalizada.
- Total Vivências é exibido como soma literal da coluna. O significado operacional ainda precisa ser confirmado com a equipe.
- Os campos de nome do candidato e nome do colaborador não são enviados ao navegador nem incluídos no CSV.

## Testes

Execute node --test ou npm test.

Para conferir a conexão real com a fonte sem exibir nomes, execute node tests/live-check.js.
