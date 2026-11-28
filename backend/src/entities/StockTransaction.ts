import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Component } from "./Component.js";
import { User } from "./User.js";

export enum StockAction {
  STOCK_IN = "STOCK_IN",
  STOCK_OUT = "STOCK_OUT",
  ADJUSTMENT = "ADJUSTMENT",
}

@Entity({ name: "stock_transactions" })
@Index("IDX_stock_transactions_component_created", ["componentId", "createdAt"])
@Index("IDX_stock_transactions_user_created", ["userId", "createdAt"])
@Index("IDX_stock_transactions_action_created", ["actionType", "createdAt"])
@Index("IDX_stock_transactions_created", ["createdAt"])
@Check(
  "CHK_stock_transactions_previous_nonnegative",
  `"previous_quantity" >= 0`,
)
@Check("CHK_stock_transactions_new_nonnegative", `"new_quantity" >= 0`)
@Check(
  "CHK_stock_transactions_change_matches",
  `"quantity_change" = "new_quantity" - "previous_quantity"`,
)
@Check(
  "CHK_stock_transactions_action_direction",
  `("action_type" = 'STOCK_IN' AND "quantity_change" > 0) OR ("action_type" = 'STOCK_OUT' AND "quantity_change" < 0) OR "action_type" = 'ADJUSTMENT'`,
)
@Check(
  "CHK_stock_transactions_component_name_nonempty",
  `length(trim("component_name")) > 0`,
)
@Check(
  "CHK_stock_transactions_username_nonempty",
  `length(trim("username")) > 0`,
)
@Check(
  "CHK_stock_transactions_comment_length",
  `"comment" IS NULL OR length("comment") <= 500`,
)
export class StockTransaction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "component_id", type: "uuid" })
  componentId!: string;

  @ManyToOne(() => Component, { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "component_id" })
  component!: Component;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ name: "component_name", type: "varchar", length: 200 })
  componentName!: string;

  @Column({ type: "varchar", length: 100 })
  username!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({
    name: "action_type",
    type: "enum",
    enum: StockAction,
    enumName: "stock_action_enum",
  })
  actionType!: StockAction;

  @Column({ name: "previous_quantity", type: "integer" })
  previousQuantity!: number;

  @Column({ name: "new_quantity", type: "integer" })
  newQuantity!: number;

  @Column({ name: "quantity_change", type: "integer" })
  quantityChange!: number;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  createdAt!: Date;
}
