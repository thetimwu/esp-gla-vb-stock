import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitialInventorySchema1710000000000 implements MigrationInterface {
  name = "InitialInventorySchema1710000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('ADMIN', 'ENGINEER')
    `);
    await queryRunner.query(`
      CREATE TYPE "stock_action_enum" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT')
    `);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar(100) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "role" "user_role_enum" NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "password_change_required" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_users_username_nonempty" CHECK (length(trim("username")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_username_lower" ON "users" (lower("username"))
    `);
    await queryRunner.query(`
      CREATE TABLE "components" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(200) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "part_number" varchar(100),
        "current_quantity" integer NOT NULL DEFAULT 0,
        "minimum_stock_level" integer NOT NULL DEFAULT 0,
        "photo_path" text,
        "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_components_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_components_name_nonempty" CHECK (length(trim("name")) > 0),
        CONSTRAINT "CHK_components_quantity_nonnegative" CHECK ("current_quantity" >= 0),
        CONSTRAINT "CHK_components_minimum_nonnegative" CHECK ("minimum_stock_level" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_components_active_name" ON "components" ("is_active", "name")
    `);
    await queryRunner.query(`
      CREATE TABLE "stock_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "component_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "action_type" "stock_action_enum" NOT NULL,
        "previous_quantity" integer NOT NULL,
        "new_quantity" integer NOT NULL,
        "quantity_change" integer NOT NULL,
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_transactions_previous_nonnegative" CHECK ("previous_quantity" >= 0),
        CONSTRAINT "CHK_stock_transactions_new_nonnegative" CHECK ("new_quantity" >= 0),
        CONSTRAINT "CHK_stock_transactions_change_matches" CHECK ("quantity_change" = "new_quantity" - "previous_quantity"),
        CONSTRAINT "FK_stock_transactions_component" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_transactions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_transactions_component_created" ON "stock_transactions" ("component_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_transactions_user_created" ON "stock_transactions" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid,
        "action" varchar(150) NOT NULL,
        "entity_type" varchar(100) NOT NULL,
        "entity_id" uuid NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_user_created" ON "audit_logs" ("user_id", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "stock_transactions"`);
    await queryRunner.query(`DROP TABLE "components"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "stock_action_enum"`);
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
  }
}
