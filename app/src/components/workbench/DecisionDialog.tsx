import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type DecisionRequest = {
  title: string;
  description: string;
  fields: {
    name: string;
    label: string;
    type?: "text" | "textarea" | "number";
    defaultValue?: string;
    minLength?: number;
    min?: number;
    step?: string;
  }[];
  onConfirm: (form: FormData) => Promise<unknown>;
};

export function DecisionDialog({
  request,
  onClose,
}: {
  request: DecisionRequest | null;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const id = useId();
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => {
    if (!request || !dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [request, dirty]);

  if (!request) return null;
  const close = () => {
    if (pending) toast.info("正在保存，请稍候再关闭");
    else if (dirty) setDiscard(true);
    else onClose();
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={event => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <DialogHeader className="pr-10">
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>{request.description}</DialogDescription>
          </DialogHeader>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3"
            aria-label="关闭确认窗口"
            disabled={pending}
            onClick={close}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
          <form
            aria-busy={pending}
            onChange={() => setDirty(true)}
            onSubmit={async event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setError("");
              setPending(true);
              try {
                await request.onConfirm(form);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "保存失败，请稍后重试"
                );
                setPending(false);
                return;
              }
              setPending(false);
              setDirty(false);
              onClose();
            }}
            className="space-y-5"
          >
            <fieldset disabled={pending} className="min-w-0 space-y-4">
              {request.fields.map(field => (
                <label
                  key={field.name}
                  htmlFor={`${id}-${field.name}`}
                  className="grid gap-2 text-sm"
                >
                  <span className="font-medium">{field.label} *</span>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={`${id}-${field.name}`}
                      name={field.name}
                      required
                      minLength={field.minLength ?? 1}
                      defaultValue={field.defaultValue}
                    />
                  ) : (
                    <Input
                      id={`${id}-${field.name}`}
                      name={field.name}
                      type={field.type ?? "text"}
                      required
                      minLength={field.minLength ?? 1}
                      min={field.min}
                      step={field.step}
                      defaultValue={field.defaultValue}
                    />
                  )}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="workbench-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={close}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && (
                  <LoaderCircle
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden
                  />
                )}
                {pending ? "正在保存…" : "确认保存"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃尚未保存的内容？</AlertDialogTitle>
            <AlertDialogDescription>未保存内容将丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>确认放弃</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
