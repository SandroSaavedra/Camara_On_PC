# iPhone Cam

Usa la cámara del iPhone como cámara de la PC, al estilo DroidCam. No necesita apps ni dependencias: solo Node.js y Safari. El video viaja directamente del iPhone a la PC por WebRTC dentro de la red WiFi. El servidor solo entrega las páginas y conecta las dos partes.

```
iPhone (Safari /cam) ──WebRTC──▶ Visor PC (Chrome /  u  OBS /obs) ──▶ OBS ──▶ TikTok LIVE Studio
```

## Inicio rápido

1. En la PC, dentro de esta carpeta:
   ```
   node iphone-cam.js
   ```
2. En el iPhone (Safari, misma red WiFi), abre la URL de **Cámara** que muestra la consola, por ejemplo `https://192.168.1.10:8443/cam`. Acepta el aviso del certificado y pulsa **Iniciar cámara**.
3. Para ver el video en la PC, usa **una** de estas dos opciones:
   - Navegador: `https://localhost:8443/`
   - OBS: Fuente de navegador con `http://localhost:8080/obs` (ver más abajo)

> Solo se admite **un visor a la vez**. Si se abre otro, el anterior se desconecta y muestra un aviso.

## Requisitos

| Qué | Detalle |
|-----|---------|
| Node.js | Cualquier versión reciente. No se instala nada con npm. |
| openssl | Solo la primera vez, para crear el certificado. En Windows viene con Git for Windows y el script lo encuentra automáticamente. |
| Red | La PC y el iPhone en la misma red WiFi. |
| Firewall | Permite a Node.js en **redes privadas** cuando Windows lo pregunte. |

## URLs y puertos

| URL | Protocolo | Para qué |
|-----|-----------|----------|
| `https://<IP-PC>:8443/cam` | HTTPS | iPhone. Safari exige HTTPS para usar la cámara. |
| `https://localhost:8443/` | HTTPS | Visor en el navegador de la PC, con barra y estadísticas. |
| `http://localhost:8080/obs` | HTTP (solo esta PC) | Fuente de navegador de OBS: solo video, con fondo transparente. |

Para cambiar los puertos: `node iphone-cam.js <puerto-https> <puerto-obs>`, por ejemplo `node iphone-cam.js 9443 9080`.

## Uso en OBS

1. **Ajustes → Vídeo**: resolución base y de salida en `1080x1920` y 30 FPS.
2. **Fuentes → + → Navegador**:
   - URL: `http://localhost:8080/obs`
   - Ancho `1080`, Alto `1920` (con el iPhone en horizontal: `1920 x 1080`)
   - Desmarca **Apagar fuente cuando no esté visible**.
3. Mientras no llega video, la fuente muestra un cartel de estado. El cartel desaparece cuando el video empieza.

Para llenar toda la fuente recortando los bordes, usa `http://localhost:8080/obs?fit=cover`.

## Transmitir con TikTok LIVE Studio

1. En OBS, pulsa **Iniciar cámara virtual**. En su engranaje elige *Tipo de salida: Programa*.
2. En LIVE Studio: **Añadir fuente → Cámara → OBS Virtual Camera**.
   - **Resolución:** `1080*1920`. Con 360\*640 la imagen se ve borrosa.
   - Si los textos aparecen al revés, pulsa **Girar**.
3. Revisa el micrófono en LIVE Studio. La cámara virtual de OBS **no lleva audio**.
4. **Iniciar LIVE**.

Otra opción: transmitir directamente desde OBS con la clave de transmisión de TikTok (**Ajustes → Emisión → Personalizado**). Se pierde menos calidad, pero la clave solo está disponible para cuentas habilitadas y puede cambiar en cada transmisión.

## Controles

**iPhone (`/cam`)**: cámara trasera o frontal, y resolución (1080p, 720p, 480p o 4K experimental). La línea de estado muestra lo que **captura** la cámara y lo que **envía** WebRTC.

**Visor en la PC (`/`)**: Espejo, Rotar, Pantalla completa, Ventana flotante y **Modo captura** (oculta la barra; se vuelve a mostrar con la tecla `H` o con doble clic). Las estadísticas muestran resolución, fps, Mbps, paquetes perdidos y códec.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `No se pudo ejecutar openssl` | No hay openssl o `OPENSSL_CONF` apunta a un archivo inexistente | Instala Git for Windows. El script ya ignora un `OPENSSL_CONF` roto. |
| `El puerto 8443 ya esta en uso` | Quedó otra instancia abierta | Ciérrala o usa otros puertos. |
| La fuente de OBS no muestra nada | Puerto equivocado o iPhone desconectado | La URL debe ser `http://localhost:8080/obs` (no 8443). En el iPhone pulsa **Iniciar cámara**. |
| `[-] cam desconectado` en la consola | El iPhone bloqueó la pantalla o se cambió de app | Mantén Safari en primer plano y el iPhone cargando. |
| Imagen pixelada (ej. 270x480) | WebRTC redujo la resolución por la red | Revisa la línea de estado del iPhone. Si dice `limitado: bandwidth`, acércate al router o usa WiFi de 5 GHz. |
| Nítido en OBS pero borroso en TikTok | Resolución baja de la cámara virtual en LIVE Studio | Elige `1080*1920` en la fuente y calidad alta en los ajustes de LIVE Studio. |
| Todo se traba o se reconecta sin parar | Dos visores abiertos | Deja abierto solo OBS **o** el navegador. |
| LIVE Studio: "dispositivo ocupado" | Se eligió una webcam que ya está usando OBS | Elige **OBS Virtual Camera**. |

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `iphone-cam.js` | El servidor y las páginas, en un solo archivo. |
| `cert.pem`, `key.pem` | El certificado autofirmado. Se genera solo y está en `.gitignore`. Para crearlo de nuevo, bórralos. |
