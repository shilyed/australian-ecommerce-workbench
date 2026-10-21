import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { trpc } from "@/providers/trpc";

export default function LoginPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [formError, setFormError] = useState("");

  const setupStatus = trpc.auth.setupStatus.useQuery(undefined, {
    retry: false,
  });

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setFormError("");
      await utils.invalidate();
      navigate("/", { replace: true });
    },
    onError: error => setFormError(error.message),
  });

  const setup = trpc.auth.setup.useMutation({
    onSuccess: async () => {
      setFormError("");
      await utils.invalidate();
      navigate("/", { replace: true });
    },
    onError: error => setFormError(error.message),
  });

  const needsSetup = setupStatus.data?.needsSetup === true;
  const pending = login.isPending || setup.isPending;

  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    login.mutate({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
  };

  const submitSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setFormError("两次输入的密码不一致");
      return;
    }
    setup.mutate({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password,
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,hsla(var(--primary)/0.16),transparent_34%),radial-gradient(circle_at_82%_80%,hsla(var(--primary)/0.1),transparent_38%)]" />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle className="h-10 w-10 border bg-card/80" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="hidden lg:block">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-primary">
              AUSTRALIAN ECOMMERCE WORKBENCH
            </p>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
              把中澳跨境的订单、库存、采购与利润，放回同一条经营链路。
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground">
              工作台数据保存在你自己的服务器和数据库中。登录只使用工作台账户，
              不再经过 Kimi 或其他第三方身份平台。
            </p>
            <div className="mt-8 grid max-w-lg gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/45 p-3">
                <ShieldCheck className="h-5 w-5 text-primary" />
                密码使用 scrypt 加盐散列，会话 Cookie 仅服务端可读
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/45 p-3">
                <LockKeyhole className="h-5 w-5 text-primary" />
                首次启动创建管理员，之后由管理员添加成员
              </div>
            </div>
          </div>

          <Card className="w-full border-border/70 bg-card/85 shadow-2xl backdrop-blur">
            <CardHeader className="space-y-2 text-center">
              <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                <LockKeyhole className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                {needsSetup ? "创建管理员账号" : "登录工作台"}
              </CardTitle>
              <CardDescription>
                {needsSetup
                  ? "这是首次启动。创建后即可进入系统，之后不再开放初始化。"
                  : "中澳跨境电商工作台"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {setupStatus.isLoading ? (
                <div className="flex min-h-52 items-center justify-center text-muted-foreground">
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  正在检查系统状态
                </div>
              ) : setupStatus.error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
                  无法连接服务器数据库，请检查部署状态后刷新页面。
                </div>
              ) : needsSetup ? (
                <form className="space-y-4" onSubmit={submitSetup}>
                  <div>
                    <label className="ops-label" htmlFor="setup-name">
                      管理员姓名
                    </label>
                    <Input
                      id="setup-name"
                      name="name"
                      required
                      autoComplete="name"
                      className="min-h-11"
                    />
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="setup-email">
                      登录邮箱
                    </label>
                    <Input
                      id="setup-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      className="min-h-11"
                    />
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="setup-password">
                      密码
                    </label>
                    <Input
                      id="setup-password"
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      className="min-h-11"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      至少 12 位，同时包含字母和数字。
                    </p>
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="setup-confirm">
                      确认密码
                    </label>
                    <Input
                      id="setup-confirm"
                      name="confirmPassword"
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      className="min-h-11"
                    />
                  </div>
                  {formError && (
                    <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
                      {formError}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="min-h-11 w-full"
                    disabled={pending}
                  >
                    {pending && (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {pending ? "正在创建…" : "创建管理员并进入工作台"}
                  </Button>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={submitLogin}>
                  <div>
                    <label className="ops-label" htmlFor="login-email">
                      邮箱
                    </label>
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      autoFocus
                      className="min-h-11"
                    />
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="login-password">
                      密码
                    </label>
                    <Input
                      id="login-password"
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      className="min-h-11"
                    />
                  </div>
                  {formError && (
                    <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
                      {formError}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="min-h-11 w-full"
                    disabled={pending}
                  >
                    {pending && (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {pending ? "正在登录…" : "登录"}
                  </Button>
                  <p className="text-center text-xs leading-5 text-muted-foreground">
                    忘记密码请联系管理员重置。连续输错 5 次会暂时锁定账号。
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
