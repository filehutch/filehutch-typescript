import { DirectUploadError, directUpload } from "./direct-upload.js"
import type { UploadedFile } from "./direct-upload.js"

/**
 * <filehutch-upload> — a file input that uploads straight to storage and puts
 * the resulting file id in a hidden field your form submits.
 *
 *   <form action="/users/1" method="post">
 *     <filehutch-upload policy="avatars" name="user[avatar_file_id]" accept="image/*">
 *     </filehutch-upload>
 *     <button>Save</button>
 *   </form>
 *
 * A custom element rather than a framework component, so the same tag works in
 * React, Vue, Svelte, Hotwire, or a plain .html file. It builds its children in
 * the light DOM, so your own CSS styles them exactly as it would any input.
 *
 * Events bubble and are composed: filehutch:start, filehutch:progress
 * (detail.percent), filehutch:complete (detail.file), filehutch:error
 * (detail.error).
 */
export class FileHutchUploadElement extends HTMLElement {
  static readonly tagName = "filehutch-upload"
  static get observedAttributes() {
    return ["accept", "disabled", "multiple"]
  }

  private input!: HTMLInputElement
  private hiddenField!: HTMLInputElement
  private progress!: HTMLProgressElement
  private status!: HTMLElement
  private controller: AbortController | null = null
  private built = false

  /** The uploaded file's id, or "" — the value the surrounding form submits. */
  get fileId(): string {
    return this.hiddenField?.value ?? ""
  }

  set fileId(value: string) {
    this.build()
    this.hiddenField.value = value ?? ""
  }

  get uploading(): boolean {
    return this.controller !== null
  }

  connectedCallback() {
    this.build()
  }

  disconnectedCallback() {
    this.controller?.abort()
  }

  attributeChangedCallback() {
    if (!this.built) return
    this.input.accept = this.getAttribute("accept") ?? ""
    this.input.disabled = this.hasAttribute("disabled")
  }

  /** Cancels an upload in flight. Safe to call when nothing is running. */
  abort() {
    this.controller?.abort()
  }

  private build() {
    if (this.built) return
    this.built = true

    this.input = this.querySelector<HTMLInputElement>("input[type=file]") ?? document.createElement("input")
    this.input.type = "file"
    if (this.hasAttribute("accept")) this.input.accept = this.getAttribute("accept")!
    if (this.hasAttribute("disabled")) this.input.disabled = true
    if (!this.input.isConnected) this.appendChild(this.input)

    this.hiddenField = document.createElement("input")
    this.hiddenField.type = "hidden"
    // Without a name the form submits nothing, which is the useful default for
    // callers reading .fileId or listening for filehutch:complete instead.
    if (this.hasAttribute("name")) this.hiddenField.name = this.getAttribute("name")!
    this.appendChild(this.hiddenField)

    this.progress = document.createElement("progress")
    this.progress.max = 100
    this.progress.value = 0
    this.progress.hidden = true
    this.appendChild(this.progress)

    this.status = document.createElement("span")
    this.status.setAttribute("role", "status")
    this.status.setAttribute("aria-live", "polite")
    this.appendChild(this.status)

    this.input.addEventListener("change", () => this.upload())
  }

  private async upload() {
    const file = this.input.files?.[0]
    if (!file) return

    const policy = this.getAttribute("policy")
    if (!policy) {
      this.fail(new DirectUploadError("<filehutch-upload> needs a policy attribute", { code: "invalid" }))
      return
    }

    this.controller = new AbortController()
    this.busy(true)
    this.emit("start", { file })

    try {
      const uploaded = await directUpload(file, {
        policy,
        ...(this.getAttribute("endpoint") ? { url: this.getAttribute("endpoint")! } : {}),
        signal: this.controller.signal,
        onProgress: (percent) => {
          this.progress.value = percent
          this.emit("progress", { percent })
        },
      })
      this.hiddenField.value = uploaded.id
      this.note(`${uploaded.filename} uploaded`)
      this.emit("complete", { file: uploaded })
    } catch (error) {
      this.hiddenField.value = ""
      this.fail(error)
    } finally {
      this.controller = null
      this.busy(false)
    }
  }

  private fail(error: unknown) {
    this.note(error instanceof Error ? error.message : String(error), true)
    this.emit("error", { error })
  }

  // A half-uploaded form must not be submittable, so the surrounding form's
  // submit controls are disabled for the duration.
  private busy(state: boolean) {
    this.toggleAttribute("uploading", state)
    this.progress.hidden = !state
    if (state) this.progress.value = 0
    for (const button of this.submitControls()) button.disabled = state
  }

  private submitControls(): Array<HTMLButtonElement | HTMLInputElement> {
    const form = this.closest("form")
    if (!form) return []
    return Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button[type=submit], input[type=submit], button:not([type])",
    ))
  }

  private note(message: string, isError = false) {
    this.status.textContent = message
    this.status.dataset.filehutchState = isError ? "error" : "ok"
  }

  private emit(name: string, detail: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent(`filehutch:${name}`, { detail, bubbles: true, composed: true }))
  }
}

/**
 * Registers <filehutch-upload>. Safe to call more than once, and a no-op when
 * there is no custom element registry (server rendering, tests).
 */
export function defineUploadElement(tagName: string = FileHutchUploadElement.tagName): void {
  if (typeof customElements === "undefined") return
  if (customElements.get(tagName)) return
  customElements.define(tagName, FileHutchUploadElement)
}
