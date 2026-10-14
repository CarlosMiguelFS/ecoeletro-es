// Popula o banco com municípios, categorias, pontos de coleta e o usuário admin.
// Pode ser executado várias vezes: usa upsert, então não duplica nada.
//
// SEED_DADOS=reais      (padrão) pontos reais de seed/pontos-reais.csv, geocodificados pelo Nominatim
// SEED_DADOS=ficticios  pontos fictícios de seed/pontos-ficticios.json (usado pelos testes, sem internet)
// SEED_DADOS=ambos      os dois
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';
import { importarCsv } from '../src/services/importacao.service.js';

const MARCA_FICTICIO = 'Dado fictício para apresentação.';
const modo = process.env.SEED_DADOS || 'reais';

const lerArquivo = (arquivo) => readFileSync(new URL(`../seed/${arquivo}`, import.meta.url));
const lerJson = (arquivo) => JSON.parse(lerArquivo(arquivo).toString('utf8'));

async function carregarBase() {
  const { municipios } = lerJson('municipios-es.json');
  for (const m of municipios) {
    await prisma.municipio.upsert({
      where: { nome: m.nome },
      update: { latitudeCentro: m.latitude, longitudeCentro: m.longitude },
      create: { nome: m.nome, latitudeCentro: m.latitude, longitudeCentro: m.longitude },
    });
  }

  const { categorias } = lerJson('pontos-ficticios.json');
  for (const c of categorias) {
    await prisma.categoria.upsert({
      where: { slug: c.slug },
      update: { nome: c.nome },
      create: { slug: c.slug, nome: c.nome },
    });
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@ecoeletro.local').toLowerCase();
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SENHA) {
    throw new Error('Defina ADMIN_SENHA: em produção o admin não pode usar a senha padrão.');
  }
  const senha = process.env.ADMIN_SENHA || 'trocar123';
  await prisma.usuarioAdmin.upsert({
    where: { email },
    update: {},
    create: { nome: 'Administrador', email, senhaHash: await bcrypt.hash(senha, 10), papel: 'admin' },
  });

  console.log(`Base: ${municipios.length} municípios, ${categorias.length} categorias, admin ${email}.`);
}

async function carregarFicticios() {
  const { pontos } = lerJson('pontos-ficticios.json');
  for (const p of pontos) {
    const municipio = await prisma.municipio.findUniqueOrThrow({ where: { nome: p.municipio } });
    const cats = await prisma.categoria.findMany({ where: { slug: { in: p.categorias } } });
    const vinculos = cats.map((c) => ({ categoriaId: c.id }));
    const dados = {
      nome: p.nome,
      tipo: p.tipo,
      logradouro: p.logradouro,
      numero: p.numero,
      bairro: p.bairro,
      cep: p.cep,
      municipioId: municipio.id,
      latitude: p.latitude,
      longitude: p.longitude,
      telefone: p.telefone,
      horario: JSON.stringify(p.horario),
      observacoes: MARCA_FICTICIO,
      ativo: p.ativo,
      verificadoEm: new Date(),
    };
    await prisma.pontoColeta.upsert({
      where: { nome_cep_numero: { nome: p.nome, cep: p.cep, numero: p.numero } },
      update: { ...dados, categorias: { deleteMany: {}, create: vinculos } },
      create: { ...dados, categorias: { create: vinculos } },
    });
  }
  console.log(`Fictícios: ${pontos.length} pontos.`);
}

async function carregarReais() {
  console.log('Reais: importando seed/pontos-reais.csv (endereços novos levam ~1 s cada no Nominatim)...');
  const resultado = await importarCsv(lerArquivo('pontos-reais.csv'));
  console.log(
    `Reais: ${resultado.criados} criados, ${resultado.atualizados} atualizados, ${resultado.erros.length} com erro.`,
  );
  for (const erro of resultado.erros) console.log(`  linha ${erro.linha}: ${erro.mensagem}`);
}

async function main() {
  if (!['reais', 'ficticios', 'ambos'].includes(modo)) {
    throw new Error(`SEED_DADOS inválido: "${modo}". Use reais, ficticios ou ambos.`);
  }
  await carregarBase();

  if (modo === 'reais') {
    const { count } = await prisma.pontoColeta.deleteMany({ where: { observacoes: MARCA_FICTICIO } });
    if (count) console.log(`Removidos ${count} pontos fictícios.`);
  }
  if (modo !== 'reais') await carregarFicticios();
  if (modo !== 'ficticios') await carregarReais();
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
