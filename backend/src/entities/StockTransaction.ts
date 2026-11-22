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
@Check(
  "CHK_stock_transactions_previous_nonnegative",
  `"previous_quantity" >= 0`,
)
@Check("CHK_stock_transactions_new_nonnegative", `"new_quantity" >= 0`)
@Check(
  "CHK_stock_transactions_change_matches",
  `"quantity_change" = "new_quantity" - "previous_quantity"`,
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
