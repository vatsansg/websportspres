import { CommonModule } from "@angular/common";
import { Component, HostListener, OnInit, Output, EventEmitter, signal } from "@angular/core";
import { AssetRules, AssetRulesService } from "../../core/asset-rules.service";

// View-only reference popup (any authenticated role) for every asset-naming/validation
// rule the app actually enforces - single-sourced from the server's own validation
// constants via /api/asset-rules, so this can never drift from real behavior. Step 5 is
// expected to add Edit/Save here, restricted to Admin/SuperAdmin, per the user's request.
@Component({
  selector: "app-asset-rules-modal",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./asset-rules-modal.component.html",
  styleUrl: "./asset-rules-modal.component.scss",
})
export class AssetRulesModalComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();

  readonly rules = signal<AssetRules | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor(private assetRules: AssetRulesService) {}

  async ngOnInit() {
    try {
      this.rules.set(await this.assetRules.getRules());
    } catch {
      this.error.set("Could not load asset rules.");
    } finally {
      this.loading.set(false);
    }
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    this.close();
  }

  close() {
    this.closed.emit();
  }

  filenameRuleText(file: { filenameRule: string; requiredFilename: string | null }): string {
    if (file.filenameRule === "exact") return `Must be exactly "${file.requiredFilename}"`;
    if (file.filenameRule === "contains") return `Must contain "${file.requiredFilename}"`;
    return "Any filename accepted";
  }
}
