import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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

export function FormSheet({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
  pending = false,
  error,
  inline = false,
}: {
  title: string;
  description?: string;
  trigger?: ReactElement;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  error?: string | null;
  inline?: boolean;
}) {
  const dirty = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const descriptionId = useId();
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    dirty.current = false;
    if (!open) return;
    const preventLeave = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [open]);

  const changeOpen = (next: boolean) => {
    if (next) {
      dirty.current = false;
      onOpenChange(true);
    } else if (pending) {
      toast.info("正在保存，请稍候再关闭");
    } else if (dirty.current) {
      setDiscard(true);
    } else {
      onOpenChange(false);
    }
  };

  if (inline) {
    return (
      <section className="ops-panel w-full">
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-title">{title}</h2>
            {description && <p className="ops-subtitle">{description}</p>}
          </div>
        </div>
        {children}
        {error && (
          <p role="alert" className="workbench-error m-4">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={changeOpen}>
        {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        <SheetContent
          className="workbench-form-sheet"
          showCloseButton={false}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={event => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <SheetHeader className="relative border-b p-6 pr-16">
            <SheetTitle className="text-xl leading-7">{title}</SheetTitle>
            {description && (
              <SheetDescription id={descriptionId}>
                {description}
              </SheetDescription>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4"
              aria-label={`关闭${title}`}
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            onChangeCapture={() => {
              dirty.current = true;
            }}
            aria-busy={pending}
          >
            <fieldset className="min-w-0" disabled={pending}>
              {children}
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t p-4">
            {error && (
              <p role="alert" className="workbench-error w-full">
                {error}
              </p>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              关闭
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃尚未保存的内容？</AlertDialogTitle>
            <AlertDialogDescription>未保存内容将丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirty.current = false;
                setDiscard(false);
                onOpenChange(false);
              }}
            >
              确认放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
