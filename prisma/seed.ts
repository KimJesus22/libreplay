// Semilla de usuario admin (F1, tasks.md). Corre con `pnpm prisma:seed`
// (o automáticamente tras `prisma migrate dev` / `migrate reset`).
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Credenciales por env para no hornear un password conocido en el repo;
  // los defaults solo sirven en dev local (y el sufijo .local del email
  // grita que no es una cuenta real).
  const email = process.env.ADMIN_EMAIL ?? 'admin@libreplay.local';
  const password = process.env.ADMIN_PASSWORD ?? 'admin-cambiame';

  // upsert: la semilla es idempotente — correrla dos veces no duplica ni
  // revienta. Si el usuario ya existe solo garantiza el rol; no le pisa el
  // password por si ya lo cambió.
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: Role.ADMIN },
    create: { email, password: await argon2.hash(password), role: Role.ADMIN },
  });
  console.log(`Admin listo: ${admin.email} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
