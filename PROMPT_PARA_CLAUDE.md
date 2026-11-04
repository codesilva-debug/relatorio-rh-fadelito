# Prompt de revisão do protótipo

Leia primeiro README.md e CONTEXTO_PARA_CLAUDE.md. Depois revise o projeto inteiro como engenheiro responsável por confiabilidade de um relatório administrativo de RH.

O objetivo é melhorar a solução sem perder simplicidade. A interface deve continuar profissional, clara, direta e sem texto de preenchimento. O projeto precisa continuar funcionando como site independente, localmente e no Vercel.

## Antes de alterar qualquer arquivo

1. Faça uma revisão de arquitetura, segurança, consistência dos dados e experiência de uso.
2. Identifique riscos reais e priorize por impacto.
3. Verifique como as funções do Vercel recebem requisições e como a origem do Apps Script é consumida.
4. Execute node --test e node tests/server-smoke.js quando a rede estiver disponível.
5. Não altere a planilha de origem, o Mapa Fadelito ou o Ghost.

## Regras que não podem ser quebradas

- O login atual do protótipo é temporário e fixo: Master / 123.
- O usuário pediu para não usar .env e não configurar REPORT_PASSWORD ou REPORT_SESSION_SECRET nesta fase.
- A autenticação segura será adicionada depois. Não complicar o acesso agora, mas não apresentar o login atual como proteção adequada para publicação.
- A fonte é a planilha VALIDAÇÃO VAGAS JUL/DEZ.
- 741 registros úteis na última verificação; 733 vinculados ao cadastro oficial.
- Campinas (6) continua nos totais, marcado fora do mapa SP.
- Guarulhos (1) permanece como cadastro a revisar; nunca associar por aproximação.
- Global (1) não é uma escola.
- Toda linha útil deve ser contabilizada uma única vez. A soma dos grupos precisa bater com o total.
- Canceladas não entram nos totais principais de vagas; aparecem em indicadores separados.
- Dias só entra na média/mediana quando o status é Aprovado e o valor existe.
- A coluna Total Vivências deve ser apresentada como o valor da planilha até que RH confirme seu significado operacional.
- Não enviar nome de candidato nem nome de colaborador ao navegador ou ao CSV.
- Datas impossíveis não podem ser corrigidas silenciosamente. Usar carimbo como alternativa somente quando válido e manter a ocorrência auditável.
- Novas grafias de unidade ficam pendentes; não descartar nem forçar associação.
- A fonte pode falhar ou mudar. O painel deve mostrar dado desatualizado/erro claramente, nunca apresentar erro como atualização concluída.
- Não introduzir serviços pagos, banco externo ou API paga sem justificativa e autorização.
- Não publicar externamente antes da implantação da autenticação real e da proteção do endpoint do Apps Script, que atualmente pode expor nomes.

## Entrega da revisão

Apresente primeiro as conclusões e os riscos. Faça alterações pequenas, justificadas e testadas. Preserve o funcionamento local e Vercel. Ao final, informe os arquivos alterados, testes executados e pendências para publicação.
