import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activeNavigationPath } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import { DecisionDialog } from "./DecisionDialog";
import { FormSheet } from "./FormSheet";
import { EmptyPanel, LoadingPanel } from "./States";
import { StatusPill } from "./StatusPill";
import { PageHeader } from "./PageHeader";

describe("shared Nike workbench presentation", () => {
  it("omits unused descriptions instead of leaving blank helper slots", () => {
    const header = renderToStaticMarkup(
      <PageHeader eyebrow="工作台" title="选品" />
    );
    expect(header).toContain("<h1");
    expect(header.match(/<p\b/g)).toHaveLength(1);
    const empty = renderToStaticMarkup(<EmptyPanel title="暂无订单" />);
    expect(empty.match(/<p\b/g)).toHaveLength(1);
    const failure = renderToStaticMarkup(
      <EmptyPanel title="加载失败" description="网络连接失败" />
    );
    expect(failure).toContain("网络连接失败");
  });
  it("keeps status text while assigning theme-independent semantic roles", () => {
    const approved = renderToStaticMarkup(<StatusPill value="approved" />);
    expect(approved).toContain('data-tone="success"');
    expect(approved).toContain("业务确认可售");
    expect(renderToStaticMarkup(<StatusPill value="pending" />)).toContain(
      'data-tone="warning"'
    );
    expect(renderToStaticMarkup(<StatusPill value="failed" />)).toContain(
      'data-tone="danger"'
    );
    const unknown = renderToStaticMarkup(
      <StatusPill value="not-a-known-state" />
    );
    expect(unknown).toContain('data-tone="neutral"');
    expect(unknown).toContain("not-a-known-state");
  });
  it("retains contextual channel wording instead of implying platform approval", () => {
    const html = renderToStaticMarkup(
      <StatusPill value="rejected" text="不适售" />
    );
    expect(html).toContain("不适售");
    expect(html).not.toContain("淘汰");
  });
  it("keeps product and marketplace details in the inventory navigation group", () => {
    expect(activeNavigationPath("/products/1")).toBe("/inventory");
    expect(activeNavigationPath("/products/1/marketplaces/ebay")).toBe(
      "/inventory"
    );
    expect(activeNavigationPath("/orders")).toBe("/orders");
  });
  it("exposes real loading and empty messages without fabricated metrics", () => {
    const loading = renderToStaticMarkup(<LoadingPanel />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain("正在读取数据");
    const empty = renderToStaticMarkup(
      <EmptyPanel title="暂无记录" description="请先核对来源" />
    );
    expect(empty).toContain("请先核对来源");
    expect(empty).not.toContain("$0.00");
  });
  it("renders existing context forms inline without changing their field names", () => {
    const html = renderToStaticMarkup(
      <FormSheet
        inline
        open={false}
        onOpenChange={vi.fn()}
        title="上下文表单"
        description="保留当前业务记录"
      >
        <form>
          <input name="quantity-7" defaultValue="4" />
        </form>
      </FormSheet>
    );
    expect(html).toContain('name="quantity-7"');
    expect(html).toContain('value="4"');
  });
  it("does not perform a decision or create a form until explicitly requested", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      <DecisionDialog request={null} onClose={onClose} />
    );
    expect(html).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("keeps destructive actions distinct and supports native pending protection", () => {
    const html = renderToStaticMarkup(
      <Button variant="destructive" disabled>
        确认删除
      </Button>
    );
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("text-destructive-foreground");
  });
});
