import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "components" })
@Index("IDX_components_active_name", ["isActive", "name"])
@Check("CHK_components_name_nonempty", `length(trim("name")) > 0`)
@Check("CHK_components_quantity_nonnegative", `"current_quantity" >= 0`)
@Check("CHK_components_minimum_nonnegative", `"minimum_stock_level" >= 0`)
export class Component {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  @Column({ type: "text", default: "" })
  description!: string;

  @Column({ name: "part_number", type: "varchar", length: 100, nullable: true })
  partNumber!: string | null;

  @Column({ name: "current_quantity", type: "integer", default: 0 })
  currentQuantity!: number;

  @Column({ name: "minimum_stock_level", type: "integer", default: 0 })
  minimumStockLevel!: number;

  @Column({ name: "photo_path", type: "text", nullable: true })
  photoPath!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  attributes!: Record<string, unknown>;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamptz",
    default: () => "now()",
  })
  updatedAt!: Date;
}
