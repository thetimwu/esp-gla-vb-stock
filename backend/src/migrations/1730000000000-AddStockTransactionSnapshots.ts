import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddStockTransactionSnapshots1730000000000 implements MigrationInterface {
  name = "AddStockTransactionSnapshots1730000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_transactions" ADD COLUMN "component_name" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_transactions" ADD COLUMN "username" varchar(100)`,
    );
    await queryRunner.query(`
      UPDATE "stock_transactions" AS transaction
      SET "component_name" = component."name",
          "username" = actor."username"
      FROM "components" AS component, "users" AS actor
      WHERE transaction."component_id" = component."id"
        AND transaction."user_id" = actor."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        ALTER COLUMN "component_name" SET NOT NULL,
        ALTER COLUMN "username" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        ADD CONSTRAINT "CHK_stock_transactions_action_direction"
        CHECK (
          ("action_type" = 'STOCK_IN' AND "quantity_change" > 0)
          OR ("action_type" = 'STOCK_OUT' AND "quantity_change" < 0)
          OR "action_type" = 'ADJUSTMENT'
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        ADD CONSTRAINT "CHK_stock_transactions_component_name_nonempty"
        CHECK (length(trim("component_name")) > 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        ADD CONSTRAINT "CHK_stock_transactions_username_nonempty"
        CHECK (length(trim("username")) > 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        ADD CONSTRAINT "CHK_stock_transactions_comment_length"
        CHECK ("comment" IS NULL OR length("comment") <= 500)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_transactions_action_created"
        ON "stock_transactions" ("action_type", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_transactions_created"
        ON "stock_transactions" ("created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_stock_transactions_created"`);
    await queryRunner.query(
      `DROP INDEX "IDX_stock_transactions_action_created"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        DROP CONSTRAINT "CHK_stock_transactions_comment_length",
        DROP CONSTRAINT "CHK_stock_transactions_username_nonempty",
        DROP CONSTRAINT "CHK_stock_transactions_component_name_nonempty",
        DROP CONSTRAINT "CHK_stock_transactions_action_direction"
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_transactions"
        DROP COLUMN "username",
        DROP COLUMN "component_name"
    `);
  }
}
