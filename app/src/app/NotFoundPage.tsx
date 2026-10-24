import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="mx-4 w-full max-w-sm border-0 text-center">
        <CardHeader>
          <p className="text-xs text-muted-foreground">中澳跨境电商工作台</p>
          <CardTitle className="text-6xl font-bold">404</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <h1 className="text-lg font-semibold">这个页面暂时找不到了</h1>
          <p className="text-sm text-muted-foreground">
            检查链接，或返回今日经营继续处理业务。
          </p>
          <Button asChild className="w-full">
            <Link to="/">返回今日经营</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
