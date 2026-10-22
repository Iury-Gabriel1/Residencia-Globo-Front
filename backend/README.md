# Backend em tempo real

API do teleprompter construída com FastAPI e WebSocket.

## Requisitos

- Python 3.10 ou superior

## Executar localmente

A partir da raiz do repositório:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

No Windows PowerShell, ative o ambiente com `.venv\\Scripts\\Activate.ps1`.

- Saúde: http://localhost:8000/api/health
- Documentação interativa: http://localhost:8000/docs
- WebSocket: `ws://localhost:8000/ws/{session_id}`

## Sessões compartilhadas

O frontend usa a sessão `demo` por padrão. Para separar operações, abra as interfaces com o mesmo parâmetro de URL, por exemplo `?session=jornal-noite-05-10`. Operador e apresentador precisam usar exatamente o mesmo identificador de sessão.

## Rede local

Para testar em computadores diferentes na mesma rede, inicie o backend com `--host 0.0.0.0`, descubra o IP local do computador servidor e configure no frontend um arquivo `.env.local`:

```dotenv
VITE_API_URL=http://192.168.1.20:8000
VITE_WS_URL=ws://192.168.1.20:8000
```

Substitua o IP pelo endereço real do computador que executa o backend. Execute o Vite com `npm run dev -- --host 0.0.0.0` para permitir acesso na rede. O firewall deve permitir as portas usadas.

Em produção, use HTTPS/WSS, autenticação e uma lista de origens CORS explícita.

## Limitações do protótipo

O estado de sessão fica em memória: é compartilhado por conexões atendidas por este processo, mas desaparece quando o servidor reinicia e não é compartilhado entre vários workers/instâncias. Para produção, use Redis ou um banco de dados. Este backend não integra iNEWS nem realiza reconhecimento de áudio ou IA.
