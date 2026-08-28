import { css, Style } from 'hono/css'
import type { ClientInfo } from '@cloudflare/workers-oauth-provider'
import type { DiscordIdentity } from '../usecases/ports'

const bodyClass = css`
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f4f5f7;
  color: #1c1e21;
  font:
    16px/1.6 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Noto Sans TC',
    'PingFang TC',
    Roboto,
    sans-serif;

  @media (prefers-color-scheme: dark) {
    background: #1a1b1e;
    color: #e8eaed;
  }
`

const cardClass = css`
  width: 100%;
  max-width: 30rem;
  padding: 32px;
  border: 1px solid #dcdfe4;
  border-radius: 12px;
  background: #ffffff;

  h1 {
    margin: 0 0 4px;
    font-size: 1.35rem;
  }

  .who {
    margin: 0 0 24px;
    color: #5c6670;
    font-size: 0.9rem;
  }

  dl {
    margin: 0 0 20px;
    padding: 16px;
    border: 1px solid #dcdfe4;
    border-radius: 8px;
  }

  dt {
    color: #5c6670;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  dd {
    margin: 2px 0 14px;
    word-break: break-all;
  }

  dd:last-of-type {
    margin-bottom: 0;
  }

  dd.target {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .warn {
    margin: 0 0 24px;
    padding: 12px 14px;
    border-radius: 8px;
    background: #fff6e0;
    color: #8a6100;
    font-size: 0.88rem;
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  button {
    flex: 1;
    padding: 11px 16px;
    border: 1px solid #dcdfe4;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
  }

  button[value='approve'] {
    border-color: transparent;
    background: #5865f2;
    color: #ffffff;
    font-weight: 600;
  }

  @media (prefers-color-scheme: dark) {
    border-color: #35383d;
    background: #232529;

    dl,
    button {
      border-color: #35383d;
    }

    .who,
    dt {
      color: #9aa2ab;
    }

    .warn {
      background: #33291340;
      color: #e8c37a;
    }
  }
`

export const ConsentPage = ({
  client,
  user,
  /** The address this request would send the code to, which a client with
   * several registered addresses does not determine by being looked up. */
  redirectTarget,
  scopes,
  approval,
  action,
}: {
  client: ClientInfo | null
  user: DiscordIdentity
  redirectTarget: string
  scopes: string[]
  approval: string
  action: string
}) => (
  <html lang="zh-Hant">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>授權 MCP 用戶端</title>
      <Style />
    </head>
    <body class={bodyClass}>
      <main class={cardClass}>
        <h1>授權這個用戶端？</h1>
        <p class="who">以 {user.username} 的身分登入</p>

        <dl>
          <dt>用戶端</dt>
          <dd>{client?.clientName ?? '（未提供名稱）'}</dd>
          <dt>授權碼將送往</dt>
          <dd class="target">{redirectTarget}</dd>
          <dt>取得的權限</dt>
          <dd>{scopes.length > 0 ? scopes.join('、') : '（未指定）'}</dd>
        </dl>

        <p class="warn">
          若這個流程不是你自己發起的，請按拒絕。核准後，上面那個網址就能代表你管理
          Ruby Taiwan 助理的資料。
        </p>

        <form method="post" action={action}>
          <input type="hidden" name="approval" value={approval} />
          <div class="actions">
            <button type="submit" name="decision" value="deny">
              拒絕
            </button>
            <button type="submit" name="decision" value="approve">
              核准
            </button>
          </div>
        </form>
      </main>
    </body>
  </html>
)
