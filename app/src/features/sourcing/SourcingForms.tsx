import type { FormEventHandler, ReactNode } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { label } from "@/lib/format";
import {
  nextCandidateStatus,
  type CandidateOperation,
  type Supplier,
} from "./sourcing-model";

type FormProps = {
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: () => void;
  onCancel: () => void;
  pending: boolean;
  disabled?: boolean;
  error?: string;
};

function Field({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid min-w-0 content-start gap-2 ${className}`}>
      <span className="text-xs font-semibold">{title}</span>
      {children}
    </label>
  );
}

function FormFrame({
  children,
  submitLabel,
  submitDisabled,
  onSubmit,
  onChange,
  onCancel,
  pending,
  disabled,
  error,
}: FormProps & {
  children: ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={onSubmit}
      onChange={onChange}
      aria-busy={pending}
    >
      <fieldset
        disabled={pending || disabled}
        className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-6"
      >
        {children}
      </fieldset>
      <div className="border-t p-4 sm:p-6">
        {error && (
          <p role="alert" className="sourcing-error mb-4">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="nike-button"
            onClick={onCancel}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            type="submit"
            className="nike-button"
            disabled={pending || disabled || submitDisabled}
          >
            {pending && (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            {pending ? "保存中…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SupplierForm(props: FormProps) {
  return (
    <FormFrame {...props} submitLabel="保存供应商">
      <Field title="供应商名称 *">
        <Input
          required
          autoFocus
          name="name"
          maxLength={255}
          className="sourcing-input"
        />
      </Field>
      <Field title="1688 店铺链接">
        <Input
          name="shopUrl"
          type="url"
          maxLength={1024}
          className="sourcing-input"
          placeholder="https://"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field title="联系人">
          <Input
            name="contactName"
            maxLength={255}
            className="sourcing-input"
          />
        </Field>
        <Field title="联系方式">
          <Input
            name="contactInfo"
            maxLength={512}
            className="sourcing-input"
          />
        </Field>
      </div>
      <Field title="履约 / 异常记录">
        <Textarea name="notes" className="sourcing-textarea min-h-32" />
      </Field>
    </FormFrame>
  );
}

export function CandidateForm({
  suppliers,
  ...props
}: FormProps & { suppliers: readonly Supplier[] }) {
  return (
    <FormFrame
      {...props}
      submitLabel="创建候选"
      submitDisabled={suppliers.length === 0}
    >
      <Field title="内部名称 *">
        <Input
          required
          autoFocus
          name="name"
          maxLength={255}
          className="sourcing-input"
        />
      </Field>
      <Field title="1688 商品链接 *">
        <Input
          required
          name="sourceUrl"
          type="url"
          maxLength={1024}
          className="sourcing-input"
          placeholder="https://detail.1688.com/offer/…"
        />
      </Field>
      <Field title="供应商 *">
        <select
          required
          name="supplierId"
          className="sourcing-input"
          defaultValue=""
        >
          <option value="" disabled>
            选择已登记的供应商
          </option>
          {suppliers.map(supplier => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      {suppliers.length === 0 && (
        <p role="alert" className="sourcing-warning-text text-sm">
          请先添加供应商。
        </p>
      )}
      <Field title="候选规格 *">
        <Input
          required
          name="spec"
          maxLength={512}
          className="sourcing-input"
          placeholder="颜色、容量、款式或包装规格"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field title="人民币报价 *">
          <Input
            required
            name="quote"
            type="number"
            step="0.01"
            min="0"
            className="sourcing-input"
            placeholder="0.00"
          />
        </Field>
        <Field title="参考售价 · AUD">
          <Input
            name="referencePrice"
            type="number"
            step="0.01"
            min="0"
            className="sourcing-input"
            placeholder="选填"
          />
        </Field>
        <Field title="MOQ · 最小起订量">
          <Input
            name="moq"
            type="number"
            step="1"
            min="1"
            className="sourcing-input"
            placeholder="选填"
          />
        </Field>
        <Field title="预计交期 · 天">
          <Input
            name="leadTimeDays"
            type="number"
            step="1"
            min="1"
            className="sourcing-input"
            placeholder="选填"
          />
        </Field>
      </div>
      <Field title="备注">
        <Textarea name="notes" className="sourcing-textarea min-h-24" />
      </Field>
    </FormFrame>
  );
}

export function OperationForm({
  operation,
  ...props
}: FormProps & { operation: CandidateOperation }) {
  const candidate = operation.candidate;
  return (
    <FormFrame
      {...props}
      submitLabel={
        operation.kind === "status"
          ? "确认推进"
          : operation.kind === "compliance"
            ? "保存业务判断"
            : "确认转为 SKU"
      }
    >
      <div className="border-b pb-4">
        <p className="mt-1 font-semibold leading-6">{candidate.name}</p>
      </div>
      {operation.kind === "status" && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-4 text-sm">
            <span>{label(candidate.status)}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <strong>{label(nextCandidateStatus(candidate))}</strong>
          </div>
          <Field title="状态推进 / 决策说明 *">
            <Textarea
              required
              autoFocus
              name="decisionNote"
              className="sourcing-textarea min-h-32"
            />
          </Field>
        </>
      )}
      {operation.kind === "compliance" && (
        <>
          <div className="sourcing-notice items-start">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>仅记录业务判断，不代表平台审核通过。</p>
          </div>
          <Field
            title={`${operation.platform === "etsy" ? "Etsy 创意 / 生产合作披露" : "eBay / 澳洲产品安全"}依据（至少 3 字）*`}
          >
            <Textarea
              required
              autoFocus
              minLength={3}
              name="basis"
              className="sourcing-textarea min-h-40"
            />
          </Field>
        </>
      )}
      {operation.kind === "convert" && (
        <>
          <p className="text-sm leading-6 text-muted-foreground">
            仅创建内部 SKU，不会上架。
          </p>
          <Field title="全局唯一 SKU 编码 *">
            <Input
              required
              autoFocus
              name="skuCode"
              maxLength={255}
              defaultValue={`AU-${String(candidate.id).padStart(4, "0")}`}
              className="sourcing-input font-mono"
            />
          </Field>
          <Field title="转正式 SKU 的决策说明 *">
            <Textarea
              required
              name="decisionNote"
              className="sourcing-textarea min-h-32"
            />
          </Field>
        </>
      )}
    </FormFrame>
  );
}
