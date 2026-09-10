import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";

import { AuthenticatedRequest } from "./auth.types";
import { runInWorkspaceContext } from "./workspace-context";

/** 把 Guard 已验证的空间挂载到 Controller 及其全部异步 Service 调用链。 */
@Injectable()
export class WorkspaceContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const workspaceId = request.currentWorkspace?.id;
    const currentUser = request.currentUser;

    if (!workspaceId || !currentUser || !request.currentWorkspace) {
      return next.handle();
    }

    // Observable 是惰性执行的，必须在 AsyncLocalStorage.run 内完成订阅，而不只是创建 Observable。
    return new Observable((subscriber) =>
      runInWorkspaceContext(
        workspaceId,
        { userId: currentUser.id, role: request.currentWorkspace!.role },
        () => {
          const subscription = next.handle().subscribe(subscriber);
          return () => subscription.unsubscribe();
        }
      )
    );
  }
}
