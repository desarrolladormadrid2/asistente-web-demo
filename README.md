# Asistente Web Vivo

Demo de una web (GitHub Pages) con un chat flotante que habla con un agente de OpenCode:
tú le pides por el chat un rediseño, un contenido o una consulta, y el agente edita los archivos,
versiona en GitHub y redespliega la web en tiempo real.

## Piezas

| Ruta | Función |
| --- | --- |
| `index.html` | Web de ejemplo (última versión rediseñable desde el chat) |
| `assets/chat.{js,css}` | Widget de chat (JS puro, sin dependencias) |
| `chat-config.json` | Config pública: campo `server` = URL del túnel activo que usa el widget |
| `opencode.json` | Define el agente `web-assistant` y sus permisos |
| `prompts/web-assistant.md` | Instrucciones del agente (incluye el flujo de despliegue) |
| `server/gateway.js` | Puente local Node: CORS + auth propia + inyección de `x-opencode-directory` |
| `start-server.ps1` | Arranca gateway + túnel cloudflared |
| `.github/workflows/deploy.yml` | Publica la raíz del repo en GitHub Pages |

## Cómo se conecta el chat

```
Web (github.io)  ──>  túnel cloudflared  ──>  gateway local (127.0.0.1:4500)
                                              │  auth: contraseña del chat
                                              ▼
                          servidor OpenCode Desktop (127.0.0.1:PORT)
                                              │  auth: OPENCODE_SERVER_PASSWORD
                                              ▼
                          agente web-assistant en el directorio del proyecto
```

El widget usa `chat-config.json` para conocer la URL del túnel; el usuario puede
sobreescribirla y guardar la contraseña desde **Ajustes** (⚙) del widget (localStorage).

## Puesta en marcha

1. Descarga `cloudflared` (portable) junto a `start-server.ps1`:
   `Invoke-WebRequest https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile cloudflared.exe`
2. Ejecuta `.\start-server.ps1` (te pedirá la contraseña del chat en terminal; no se guarda en disco).
3. Se mostrará la URL del túnel (`https://xxxx.trycloudflare.com`).
4. Abre la web `https://desarrolladormadrid2.github.io/asistente-web-demo/` y, si el widget no
   detecta el túnel, pégalo en **Ajustes** junto con la contraseña.
5. Para que la web pública apunte al túnel automáticamente, dile al asistente por el chat:
   "el túnel es <URL>" y él actualizará `chat-config.json` y redesplegará.

## Agente

El agente `web-assistant` tiene permisos de edición, bash, webfetch y websearch en automático,
y `question` desactivado (las preguntas las hace en el propio chat). El despliegue usa la API REST
de GitHub con `GITHUB_PERSONAL_ACCESS_TOKEN` (flujo exacto documentado en `prompts/web-assistant.md`).

> No se guarda ningún secreto en el repositorio: la contraseña del chat y los tokens viven
> solo en variables de entorno / navegador.