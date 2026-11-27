import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSessionsTable1720000000000 implements MigrationInterface {
  name = "CreateSessionsTable1720000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "sid" varchar NOT NULL,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "PK_sessions_sid" PRIMARY KEY ("sid")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_expire" ON "sessions" ("expire")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sessions"`);
  }
}
