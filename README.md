# Dossier PDF

Una PWA móvil, sin frameworks, para abrir y leer archivos PDF página a página.

## Ejecutar en local

Los módulos de PDF.js y el *service worker* necesitan un servidor HTTP:

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080` en el navegador.

## GitHub Pages

El proyecto usa rutas relativas y no requiere compilación. Con GitHub Pages
configurado para usar **GitHub Actions**, el workflow `.github/workflows/pages.yml`
publica automáticamente la raíz del repositorio al recibir cambios en `main`.
También se puede ejecutar manualmente desde la pestaña **Actions**. La aplicación
queda disponible en `https://whitefishman.github.io/dossier-pdf-movil/`.

## Características

- Selección local y privada de documentos PDF.
- Renderizado página a página con PDF.js.
- Selección de páginas con avance automático y contador de páginas marcadas.
- Navegación táctil horizontal y mediante la acción «Continuar».
- Aplicación instalable con manifiesto y funcionamiento sin conexión de la interfaz.
