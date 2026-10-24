import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { LoaderCircle, LockKeyhole } from "lucide-react";
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
    <div className="relative min-h-screen bg-background px-4 py-8 sm:px-8">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle className="h-10 w-10 border bg-card/80" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="hidden min-h-[520px] flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
            <p className="text-xs font-medium opacity-75">
              中澳运营台 / 跨境经营
            </p>
            <div>
              <h2 className="max-w-sm text-[32px] font-bold leading-tight">
                中澳跨境
                <br />
                电商工作台
              </h2>
            </div>
          </div>

          <Card className="w-full border-0 bg-background shadow-none">
            <CardHeader className="space-y-2 text-center">
              <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
                <LockKeyhole className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-[28px] font-bold">
                <h1>{needsSetup ? "创建管理员账号" : "登录工作台"}</h1>
              </CardTitle>
              <CardDescription>中澳跨境电商工作台</CardDescription>
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
                    忘记密码请联系管理员。
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
