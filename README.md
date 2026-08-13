# Dossier Xa!

Aplicación web estable, pensada para móbil, que permite abrir un PDF no propio
dispositivo, escoller as páxinas útiles e descargalas como imaxes JPG. O arquivo
non se envía a ningún servidor.

## Uso en móbil

1. Preme **Abrir PDF** e escolle un documento.
2. Revisa as páxinas avanzando co xesto horizontal ou cos botóns. Usa
   **Seleccionar e continuar** para marcar unha páxina, ou **Seleccionar como
   primeira** para colocala ao inicio do envío.
3. Preme **Descargar imaxes** para abrir **Preparar envío**. Nesa pantalla podes
   reordenar as seleccionadas, movelas ao principio ou ao final e eliminar as
   que non necesites.
4. Confirma a descarga. Cada páxina expórtase en JPG co nome
   `AAAAMMDD_XX_paxina-X.jpg`: data, posición na orde final e número de páxina
   orixinal.

A aplicación garda localmente a páxina actual, a selección e a súa orde. Ao
volver abrir o mesmo PDF ofrece **Restaurar sesión** ou empezar de novo; o PDF
en si non queda gardado.

## Instalar como PWA

Abre a aplicación nun navegador compatible e usa **Instalar aplicación** ou
**Engadir á pantalla de inicio** no menú do navegador. A interface instalada
pode abrirse sen conexión; para cargar un documento só tes que seleccionalo
desde o dispositivo.

## Diagnóstico

O botón **🐞 Diagnóstico** mostra información do arquivo, carga de PDF.js,
renderizado de miniaturas e erros. **Borrar caché e recargar** permite resolver
problemas despois dunha actualización.

## Desenvolvemento e despregamento

É unha aplicación estática sen compilación. Para probala en local (PDF.js e o
*service worker* requiren HTTP):

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`. As probas unitarias execútanse con:

```bash
node --test
```

O workflow `.github/workflows/pages.yml` publica a raíz do repositorio en
GitHub Pages en cada cambio de `main`, ou manualmente desde **Actions**. Require
configurar Pages coa orixe **GitHub Actions**. A versión pública está en
<https://whitefishman.github.io/dossier-pdf-movil/>.
