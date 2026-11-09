# Numina 5 source alignment

The canonical application release is **5.0.0**. Its core remains **2.0.0** and its runtime remains **2.0.0-rc27**. Maintained npm packages, CI build lanes and the isolated toolchain target **Node 26.13.0**.

The canonical repository is https://github.com/Numina-Enterprise/numina-production and the public origin is https://numinalabs.xyz. The current application manifest is `/v5/release/manifest`; prior manifest routes remain compatibility aliases. Existing application and control APIs retain their versioned interfaces.

| Surface | Version / source target |
| --- | --- |
| Application, integration kit, Codex plugin | 5.0.0 |
| Core | 2.0.0 |
| Runtime | 2.0.0-rc27 |
| Node build toolchain | 26.13.0 |
| iOS | 5.0.0, build 7 |
| Android | 5.0.0, version code 5 |

`config/numina-release.v1.json` defines release versioning. `config/numina-topology.v1.json` defines the shared cloud contract. Build generation validates source alignment and publishes the actual artifact inventory. New source archives have version 5.0.0 filenames. Previous release archives and signed binaries retain their original bytes and dated evidence; they are not relabeled as Numina 5 binaries.

Fresh mobile compilation, signing, store submission and live cloud deployment each require their own provider receipts. The current native record is `native-package-record-v5.json`.

The frozen core manifest retains its original digest. Executable/source files remain hash checked. Five uncommitted historical pytest cache files may be absent from a clean checkout; source alignment reports them as missing cache inputs and does not claim a complete 245-file restoration. Three existing frozen files are restored from byte-identical retained sources to match the preserved manifest.
