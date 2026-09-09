# Each DV's own panel is built in its section above (qA to qE). This
# section only assembles them into the two paired paper figures.

# =====================================================================
# AI Disappear Maze - analysis
#
# Design: 3 (condition, between) x 2 (phase, within) mixed factorial.
# 150 participants (50 per condition), 8 mazes each.
# Mazes 1-4 = Early, 5-8 = Late.
# Main test throughout: the Condition x Phase interaction.
#
# Companion document: analysis.md (decisions, justifications, results)
# =====================================================================

library(tidyverse)
library(glmmTMB)
library(DHARMa)
library(emmeans)
library(patchwork)   # multi-panel figures (section 14)


# ---- plot theme -----------------------------------------------------
# Export with: ggsave(path, width = 7, height = 4.5, dpi = 300)

theme_thesis <- theme_minimal(base_size = 16) +
  theme(
    axis.title       = element_text(size = 16),
    axis.text        = element_text(size = 14, colour = "black"),
    legend.title     = element_text(size = 15),
    legend.text      = element_text(size = 14),
    strip.text       = element_text(size = 15),
    legend.position  = "top",
    panel.grid.minor = element_blank()
  )

# Draws the Early-to-Late interaction figure from an emmeans object.
# `scale` divides the estimate (use 1000 to turn ms into seconds).
# Plain working plotter, kept for quick looks during analysis. The
# paper figures use plot_paper() below.
plot_emm <- function(e, ylab, scale = 1) {
  d <- as.data.frame(summary(e, type = "response"))
  est <- intersect(c("response", "emmean"), names(d))[1]
  lo  <- intersect(c("asymp.LCL", "lower.CL"), names(d))[1]
  hi  <- intersect(c("asymp.UCL", "upper.CL"), names(d))[1]
  d$est <- d[[est]] / scale
  d$lo  <- d[[lo]]  / scale
  d$hi  <- d[[hi]]  / scale
  pd <- position_dodge(0.06)
  ggplot(d, aes(x = phase, y = est, colour = condition, group = condition)) +
    geom_line(linewidth = 1, position = pd) +
    geom_point(size = 3, position = pd) +
    geom_errorbar(aes(ymin = lo, ymax = hi), width = 0.08, position = pd) +
    scale_colour_brewer(
      palette = "Dark2",
      # Display names for the paper. The underlying factor levels stay
      # no_ai / stable_ai / disappear so the model reference level is
      # unaffected; this only relabels the legend.
      labels = c(no_ai = "No AI", stable_ai = "Stable AI",
                 disappear = "AI Disappear")) +
    labs(x = NULL, y = ylab, colour = "Condition") +
    theme_thesis
}


# Colours taken from the mockup.
cond_cols <- c(no_ai     = "#5CC5E8",   # light blue
               stable_ai = "#2E5E8E",   # dark navy
               disappear = "#F4695E")   # coral

cond_names <- c(no_ai     = "No AI",
                stable_ai = "Stable AI",
                disappear = "AI Disappear")

# `panel` is the letter, `title` the DV name; they are drawn together.
# `scale` divides the estimate (1000 turns ms into seconds).
plot_paper <- function(e, title, panel, ylab, scale = 1) {
  d <- as.data.frame(summary(e, type = "response"))
  est <- intersect(c("response", "emmean"), names(d))[1]
  lo  <- intersect(c("asymp.LCL", "lower.CL"), names(d))[1]
  hi  <- intersect(c("asymp.UCL", "upper.CL"), names(d))[1]
  d$est <- d[[est]] / scale
  d$lo  <- d[[lo]]  / scale
  d$hi  <- d[[hi]]  / scale

  ggplot(d, aes(x = phase, y = est, colour = condition, group = condition)) +
    geom_errorbar(aes(ymin = lo, ymax = hi), width = 0, linewidth = 0.7) +
    geom_line(linewidth = 1.3) +
    geom_point(size = 2.6) +
    scale_colour_manual(values = cond_cols, labels = cond_names) +
    scale_x_discrete(expand = expansion(mult = c(0.15, 0.15))) +
    scale_y_continuous(limits = c(0, NA),
                       expand = expansion(mult = c(0, 0.10))) +
    labs(x = NULL, y = ylab, title = paste0(panel, "   ", title)) +
    theme_minimal(base_size = 14) +
    theme(
      # Boxed legend to the right of the panel, vertically centred.
      legend.position      = "right",
      legend.justification = "center",
      legend.background    = element_rect(fill = "white", colour = "black",
                                          linewidth = 0.4),
      legend.title         = element_blank(),
      legend.text          = element_text(size = 11),
      legend.key.size      = unit(14, "pt"),
      legend.margin        = margin(3, 6, 3, 6),
      plot.title           = element_text(face = "bold", size = 16, hjust = 0),
      axis.title.y       = element_text(size = 13),
      axis.text          = element_text(size = 12, colour = "black"),
      axis.text.x        = element_text(size = 13),
      panel.grid.major.x = element_blank(),
      panel.grid.minor   = element_blank(),
      panel.grid.major.y = element_line(linewidth = 0.3, colour = "grey85"),
      axis.line.x        = element_line(linewidth = 0.4, colour = "grey40"),
      plot.margin        = margin(6, 10, 6, 6)
    )
}


# Early-vs-Late within each condition, the complement to the
# condition-vs-condition contrasts. This is what supports statements
# like "no_ai improved with practice while disappear deteriorated" -
# without it those claims rest on eyeballing the EMMs.
#
# rbind() pools the three contrasts into ONE family so Holm actually
# corrects across them. Without it emmeans adjusts within each `by`
# group, and with one comparison per group that is no correction.
#
# Printed as Early / Late. All behavioural DVs are error measures, so:
#   ratio ABOVE 1 -> Early was worse -> the group IMPROVED
#   ratio BELOW 1 -> Late was worse  -> the group DETERIORATED
phase_contrasts <- function(m, comp = "cond") {
  e <- emmeans(m, ~ phase | condition, component = comp, type = "response")
  summary(rbind(contrast(e, method = "pairwise")), adjust = "holm")
}

emm_tab <- function(e, scale = 1, dp = 2) {
  t <- as.data.frame(summary(e, type = "response"))
  num <- intersect(c("response", "emmean", "SE", "asymp.LCL", "asymp.UCL"), names(t))
  t[num] <- t[num] / scale
  knitr::kable(t, digits = dp)
}

con_tab <- function(e) {
  knitr::kable(as.data.frame(confint(contrast(e, method = "pairwise", adjust = "holm"))),
               digits = 3)
}


# =====================================================================
# 1. LOAD AND CLEAN
# =====================================================================

raw <- read_csv("error_logs/kv-export/llm-maze.csv")
nrow(raw)   # expect 1169


# Some maze completions were logged twice. Keeps the first of each.
dat <- distinct(raw, participant_id, maze, .keep_all = TRUE)

# Mazes 1-4 = Early (assistance present), 5-8 = Late (withdrawn).
# NB overwrites the CSV's own `phase` column ("maze"/"training"), which
# is redundant once training is dropped.
dat <- mutate(dat, phase = if_else(maze_index < 4, "Early", "Late"))


# ---- checkpoint -----------------------------------------------------
# These targets were derived from the raw file independently of R.

nrow(dat)                        # expect 1151  (18 duplicates dropped)
n_distinct(dat$participant_id)   # expect 150   (50 per condition)
dat |> count(condition, phase)   # expect 199/189, 197/181, 197/188
dat |> count(condition)          # must be 50 participants each


# ---- factors --------------------------------------------------------
# Reference levels set explicitly. R would default to alphabetical,
# making `disappear` the reference; `no_ai` first makes every
# coefficient read as "difference from never having had AI".

dat$condition      <- factor(dat$condition, levels = c("no_ai", "stable_ai", "disappear"))
dat$phase          <- factor(dat$phase, levels = c("Early", "Late"))
dat$participant_id <- factor(dat$participant_id)

levels(dat$condition)   # must be: "no_ai" "stable_ai" "disappear"
summary(dat$condition)  # no level should be 0


# =====================================================================
# 2. DESCRIPTIVES
# =====================================================================
# Median and IQR rather than mean and SD: four of five DVs are heavily
# skewed (excess moves runs 0 to 860), so a mean misleads.

desc <- dat |> group_by(condition, phase) |> summarise(
  n_people    = n_distinct(participant_id),
  n_trials    = n(),
  excess_med  = median(excess_moves),
  excess_iqr  = IQR(excess_moves),
  time_med_s  = median(completion_ms) / 1000,
  time_iqr_s  = IQR(completion_ms) / 1000,
  revisit_med = median(revisited_cell_moves),
  revisit_iqr = IQR(revisited_cell_moves),
  back_med    = median(back_button_moves),
  back_iqr    = IQR(back_button_moves),
  .groups = "drop"
)

print(desc, width = Inf)
knitr::kable(desc, digits = 1)

# ---- zero proportions, for the zero-inflation justification ---------
zeros <- tibble(
  dv      = c("Excess moves", "Revisits", "Back affordance"),
  n_zero  = c(sum(dat$excess_moves == 0),
              sum(dat$revisited_cell_moves == 0),
              sum(dat$back_button_moves == 0)),
  n_total = nrow(dat)
) |> mutate(pct = round(100 * n_zero / n_total, 1))

zeros


# =====================================================================
# 3. DV1 - EXCESS MOVES
# =====================================================================

# ---- 3a distribution selection --------------------------------------
# Poisson assumes variance == mean. Here it exceeds the mean by two
# orders of magnitude, so Poisson is ruled out empirically, not by
# assertion.

m_excess <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, data = dat)

m_pois <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                  family = poisson, data = dat)

AIC(m_pois, m_excess)                          # Poisson far worse
testDispersion(simulateResiduals(m_pois))      # rejects Poisson
summary(m_pois)                                # SEs badly understated

# Four negative binomial specifications compared. All on the raw count
# scale, so these AICs are directly comparable (no Jacobian needed).

m_nb1    <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom1, data = dat)

m_zinb   <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1, data = dat)

m_zinb_d <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1,
                    dispformula = ~ condition * phase, data = dat)

AIC(m_excess, m_nb1, m_zinb, m_zinb_d)   # lowest wins; expect m_zinb_d

# Zero-inflation is justified substantively as well as by AIC: ~19% of
# trials achieved the optimal route exactly, a different process from
# exploring and happening to score 0. dispformula is justified because
# the cells are unequally variable (disappear Late IQR 100 vs
# stable_ai Late 12).

# ---- 3b diagnostics -------------------------------------------------
# Final model passes all five DHARMa checks.

res_excess <- simulateResiduals(m_excess)
plot(res_excess)                  # zero-inflation and Levene fails here
testZeroInflation(res_excess)     # expected to fail - why zi was added

plot(simulateResiduals(m_zinb))   # zeros fixed, Levene still fails

plot(simulateResiduals(m_zinb_d)) # expect all five tests to pass
testZeroInflation(simulateResiduals(m_zinb_d))

summary(m_zinb_d)

# ---- 3c joint test and contrasts ------------------------------------
# NB p-values are Holm-adjusted within each phase (3 tests per phase);
# emmeans falls back to Bonferroni for the intervals, as Holm does not
# produce them.

joint_tests(m_zinb_d)             # omnibus Condition x Phase test

emm <- emmeans(m_zinb_d, ~ condition | phase, component = "cond", type = "response")
emm
contrast(emm, method = "pairwise", adjust = "holm")
confint(contrast(emm, method = "pairwise", adjust = "holm"))

emm_tab(emm)
con_tab(emm)

# EMMs for tables and figures use component = "response": the overall
# expected outcome INCLUDING the structural zeros, which is what a
# reader assumes "expected excess moves" means. Contrasts stay on
# component = "cond" above, because only that yields ratios. Since
# ziformula = ~1 makes the zero-inflation a constant (it scales every
# cell by 0.939), the ratios are identical either way - verified to
# three decimals. This is a labelling choice, not a different analysis.
emm_resp <- emmeans(m_zinb_d, ~ condition | phase,
                    component = "response", type = "response")
emm_resp
emm_tab(emm_resp)

qA <- plot_paper(emm_resp, "Excess Moves", "A", "Expected excess moves")
qA
ggsave("report/figures/panel_A_excess.png", qA, width = 6.2, height = 4, dpi = 300)

# ---- 3d sensitivity --------------------------------------------------
# Did each group change from Early to Late? (see phase_contrasts above)
phase_contrasts(m_zinb_d)

# Does zero-inflation earn its place once dispersion is modelled? Refit
# WITHOUT zi but WITH dispformula, so any AIC gap is attributable to zi
# alone rather than to the two together.
m_zinb_d_nozi <- glmmTMB(excess_moves ~ condition * phase + (1 | participant_id),
                         family = nbinom2,
                         dispformula = ~ condition * phase, data = dat)
AIC(m_zinb_d, m_zinb_d_nozi)

# Sensitivity Tests:

m_excess_rs <- glmmTMB(excess_moves ~ condition * phase + (1 + phase | participant_id),
                       family = nbinom2, ziformula = ~1,
                       dispformula = ~ condition * phase, data = dat)

joint_tests(m_excess_rs)
m_excess_rs$sdr$pdHess        # TRUE  = good
m_excess_rs$fit$convergence   # 0     = converged
summary(m_excess_rs)



# =====================================================================
# 4. DV2 - COMPLETION TIME
# =====================================================================
# Uses completion_ms, EXCLUDING help pauses: only 15 of 1315 trials
# (1.1%) had any pause, and time spent reading the tutorial is not
# navigation performance.

# ---- 4a distribution selection --------------------------------------

m_time <- glmmTMB(completion_ms ~ condition * phase + (1 | participant_id),
                  family = Gamma(link = "log"), data = dat)

testDispersion(simulateResiduals(m_time))   # expected to FAIL

m_time_d <- glmmTMB(completion_ms ~ condition * phase + (1 | participant_id),
                    family = Gamma(link = "log"),
                    dispformula = ~ condition * phase, data = dat)

m_time_ln <- glmmTMB(completion_ms ~ condition * phase + (1 | participant_id),
                     family = lognormal(link = "log"),
                     dispformula = ~ condition * phase, data = dat)

AIC(m_time, m_time_d, m_time_ln)   # all on the raw ms scale
plot(simulateResiduals(m_time_d))  # still fails KS, dispersion, Levene

# Gaussian on log(time). Coefficients still read as ratios via exp().
dat$log_time <- log(dat$completion_ms)

m_time_lmm <- glmmTMB(log_time ~ condition * phase + (1 | participant_id),
                      dispformula = ~ condition * phase, data = dat)

plot(simulateResiduals(m_time_lmm))   # Levene should clear here; KS
# still fails on the task floor - see the note below

# AIC WARNING: m_time_lmm models log(completion_ms), a different
# response variable, so its raw AIC is not comparable to the others.
# Comparing across a transformed response needs the Jacobian:
AIC(m_time_lmm) + 2 * sum(log(dat$completion_ms))   # corrected, and
AIC(m_time_d)                                        # comparable to this

# Remaining misfit: the QQ plot bows above the diagonal in the 0.2-0.6
# range because the task has a hard floor of ~13 s (nobody completes a
# 53-move maze faster) while Gamma, lognormal and Gaussian-on-log are
# all anchored at zero. Reported as a limitation.

# ---- 4b joint test and contrasts ------------------------------------
# emmeans does not know log_time is a log, so tran = "log" must be set
# explicitly or the output stays on the log scale.

joint_tests(m_time_lmm)           # omnibus Condition x Phase test

emm_time <- update(emmeans(m_time_lmm, ~ condition | phase), tran = "log")

summary(emm_time, type = "response")
contrast(emm_time, method = "pairwise", adjust = "holm", type = "response")
confint(contrast(emm_time, method = "pairwise", adjust = "holm"), type = "response")

emm_tab(emm_time, scale = 1000)   # seconds
con_tab(emm_time)

qB <- plot_paper(emm_time, "Completion Time", "B", "Completion time (s)", scale = 1000)
qB
ggsave("report/figures/panel_B_time.png", qB, width = 6.2, height = 4, dpi = 300)

# ---- 4c sensitivity --------------------------------------------------
# tran = "log" is needed here or emmeans reports differences on the log
# scale rather than ratios - m_time_lmm's log comes from update(), not
# from a link function, so emmeans cannot infer it.
emm_time_p <- update(emmeans(m_time_lmm, ~ phase | condition), tran = "log")
summary(rbind(contrast(emm_time_p, method = "pairwise")),
        adjust = "holm", type = "response")

# The chosen model still fails KS because of the task's ~13 s floor, so
# show the interaction is stable across all four specifications rather
# than asserting it.
sens_time <- data.frame(
  model = c("Gamma(log)", "Gamma(log) + disp",
            "lognormal + disp", "Gaussian on log + disp"),
  estimate = c(
    fixef(m_time)$cond["conditiondisappear:phaseLate"],
    fixef(m_time_d)$cond["conditiondisappear:phaseLate"],
    fixef(m_time_ln)$cond["conditiondisappear:phaseLate"],
    fixef(m_time_lmm)$cond["conditiondisappear:phaseLate"]
  )
)
sens_time$ratio <- exp(sens_time$estimate)
knitr::kable(sens_time, digits = 3)

# Sensitivity test:

m_time_rs <- glmmTMB(log_time ~ condition * phase + (1 + phase | participant_id),
                     dispformula = ~ condition * phase, data = dat)
m_time_rs$sdr$pdHess; joint_tests(m_time_rs)
summary(m_time_rs)


# =====================================================================
# 5. DV3 - REVISITS
# =====================================================================

m_rev    <- glmmTMB(revisited_cell_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, data = dat)

m_rev_z  <- glmmTMB(revisited_cell_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1, data = dat)

m_rev_d  <- glmmTMB(revisited_cell_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1,
                    dispformula = ~ condition * phase, data = dat)

testZeroInflation(simulateResiduals(m_rev))     # ratioObsSim > 1 = plain NB under-predicts zeros

# Does zero-inflation still earn its place once dispersion is modelled?
m_rev_d2 <- glmmTMB(revisited_cell_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2,
                    dispformula = ~ condition * phase, data = dat)

AIC(m_rev, m_rev_z, m_rev_d, m_rev_d2)   # m_rev_d2 = m_rev_d minus zi
# -> yes, keep zi


plot(simulateResiduals(m_rev_d))   # expect all five tests to pass

joint_tests(m_rev_d)               # omnibus Condition x Phase test

emm_rev <- emmeans(m_rev_d, ~ condition | phase, component = "cond", type = "response")
emm_rev
contrast(emm_rev, method = "pairwise", adjust = "holm")
confint(contrast(emm_rev, method = "pairwise", adjust = "holm"))

emm_tab(emm_rev)
con_tab(emm_rev)

# See the note in section 3: response scale for display, cond for ratios.
emm_rev_resp <- emmeans(m_rev_d, ~ condition | phase,
                        component = "response", type = "response")
emm_rev_resp
emm_tab(emm_rev_resp)

qC <- plot_paper(emm_rev_resp, "Revisits", "C", "Expected revisits")
qC
ggsave("report/figures/panel_C_revisits.png", qC, width = 6.2, height = 4, dpi = 300)

# ---- 5b sensitivity --------------------------------------------------
phase_contrasts(m_rev_d)

# m_rev_d2 is m_rev_d minus zero-inflation, fitted above; the gap is
# what zi is worth on its own once dispersion is already modelled.
AIC(m_rev_d, m_rev_d2)

m_rev_rs <- glmmTMB(revisited_cell_moves ~ condition * phase + (1 + phase | participant_id),
                    family = nbinom2, ziformula = ~1,
                    dispformula = ~ condition * phase, data = dat)
m_rev_rs$sdr$pdHess; joint_tests(m_rev_rs)
summary(m_rev_rs)


# =====================================================================
# 6. DV4 - BACKTRACKING (BACK-BUTTON USE)
# =====================================================================
# NB this counts presses of the Back control only. Participants also
# retrace by turning around and walking forward, which it does not
# capture. It correlates r = .84 with positional reversals derived from
# the move log, with no systematic difference between conditions, so it
# is a valid retreat measure. Thus described as "use of the Back
# affordance", not as backtracking in general.

m_back   <- glmmTMB(back_button_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, data = dat)

m_back_z <- glmmTMB(back_button_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1, data = dat)

m_back_d <- glmmTMB(back_button_moves ~ condition * phase + (1 | participant_id),
                    family = nbinom2, ziformula = ~1,
                    dispformula = ~ condition * phase, data = dat)

AIC(m_back, m_back_z, m_back_d)    # lowest wins

plot(simulateResiduals(m_back_d))  # expect all five tests to pass

joint_tests(m_back_d)              # omnibus Condition x Phase test

emm_back <- emmeans(m_back_d, ~ condition | phase, component = "cond", type = "response")
emm_back
contrast(emm_back, method = "pairwise", adjust = "holm")
confint(contrast(emm_back, method = "pairwise", adjust = "holm"))

emm_tab(emm_back)
con_tab(emm_back)

# See the note in section 3: response scale for display, cond for ratios.
emm_back_resp <- emmeans(m_back_d, ~ condition | phase,
                         component = "response", type = "response")
emm_back_resp
emm_tab(emm_back_resp)

# Labelled "Back affordance" rather than "backtracking": it counts
# presses of the Back control only, not all physical retracing.
qD <- plot_paper(emm_back_resp, "Back-affordance Use", "D", "Expected back-affordance uses")
qD
ggsave("report/figures/panel_D_backaff.png", qD, width = 6.2, height = 4, dpi = 300)

# ---- 6b sensitivity --------------------------------------------------
phase_contrasts(m_back_d)

m_back_d_nozi <- glmmTMB(back_button_moves ~ condition * phase + (1 | participant_id),
                         family = nbinom2,
                         dispformula = ~ condition * phase, data = dat)
AIC(m_back_d, m_back_d_nozi)

# Sensitivity test:

m_back_rs <- glmmTMB(back_button_moves ~ condition * phase + (1 + phase | participant_id),
                     family = nbinom2, ziformula = ~1,
                     dispformula = ~ condition * phase, data = dat)
m_back_rs$sdr$pdHess; joint_tests(m_back_rs)
summary(m_back_rs)

# =====================================================================
# 7. DV5 - DECISION TIME
# =====================================================================

# ---- 7a maze-level attempt - REJECTED, kept for the record ----------
# median_decision_ms is a per-trial median of ~11 junction decisions.
# Modelling a summary statistic rather than observations produces a
# severe S-curve in the QQ plot. DO NOT REPORT THIS MODEL.

dat$log_dec <- log(dat$median_decision_ms)
m_dec_rejected <- glmmTMB(log_dec ~ condition * phase + (1 | participant_id),
                          dispformula = ~ condition * phase, data = dat)
plot(simulateResiduals(m_dec_rejected))   # fails badly - do not report

# ---- 7b junction-level data -----------------------------------------
# One row per junction decision, extracted from runs.json and filtered
# to the same sample as `dat`, less the three participants noted below.
# Trimming: > 5 min removed as abandonment (1 decision); < 100 ms
# removed as keyboard auto-repeat carry-over, the cutoff taken
# from the empirical antimode at 80-89 ms between a fast mode at
# 20-39 ms and a deliberation mode at ~190 ms.

# Regenerated 2026-09-03 from a FRESH runs.json fetch, so coverage is
# now complete: all 150 participants and all 1151 trials have
# event-level data. The earlier gap (cn-no_ai-091/092/093 joined after
# the 2026-08-27 export) is closed.
#
# To re-fetch:  node mazes8/scripts/fetch-runs.mjs <deployment-url>
# Both deployments share one Upstash store, so one fetch gets everyone
# (DEPLOY.md:185). Back up runs.json first - the fetch overwrites it,
# and also overwrites summaries.csv with the untrimmed export.

jn <- read_csv("error_logs/kv-export/junctions.csv")

jn$condition      <- factor(jn$condition, levels = c("no_ai", "stable_ai", "disappear"))
jn$phase          <- factor(jn$phase, levels = c("Early", "Late"))
jn$participant_id <- factor(jn$participant_id)
jn$maze_junction  <- factor(jn$maze_junction)

nrow(jn)                          # expect 16294
n_distinct(jn$participant_id)     # expect 150 - full coverage

# Pass-through rate by cell - a descriptive worth reporting in its own
# right: cued participants pause to read the cue, uncued ones do not.
jn |> group_by(condition, phase) |> summarise(n = n(), .groups = "drop")

# ---- 7c the cue-reading confound ------------------------------------
# In cued conditions the assistant's suggestion is on-screen TEXT, so
# decision_ms contains reading time that cannot be separated from
# deliberation. It cannot be estimated away: cues appear at >99% of
# junctions in cued conditions, decision time does not scale with text
# length (+9 ms per extra branch), and subtracting an assumed reading
# cost REVERSES the direction of the interaction. The Condition x Phase
# interaction is therefore not identifiable for this DV.
#
# Only contrasts between cells sharing cue status are valid. That
# includes both planned comparisons:
#   disappear Late vs no_ai Late      - both uncued - primary test
#   disappear Early vs stable_ai Early - both cued  - randomisation check

jn_clean <- droplevels(filter(jn, cue_shown == 0, phase == "Late",
                              condition != "stable_ai"))
nrow(jn_clean)   # expect 6591 decisions from 94 participants

m_dec_late <- glmmTMB(decision_ms ~ condition + (1 | participant_id) + (1 | maze_junction),
                      family = Gamma(link = "log"), data = jn_clean)

summary(m_dec_late)                                   # disappear vs no_ai
emm_dec <- emmeans(m_dec_late, ~ condition, type = "response")
emm_dec                                               # mean ms per decision
confint(contrast(emm_dec, method = "pairwise"))


# =====================================================================
# 8. DV6 - WORKLOAD (NASA-TLX)
# =====================================================================
# Responses were collected anonymously and cannot be linked to
# participant IDs, so Phase is a BETWEEN-groups factor here and no
# participant random effect is possible. This is the one DV that
# departs from the specified model form, and unavoidably so.
# Raw TLX = unweighted mean of the six subscales.
#
# Built here from the six Qualtrics exports rather than from a pre-made
# CSV, so a fresh survey export needs no manual prep step.
#
# Qualtrics writes THREE header rows: variable names, question labels,
# then an importId JSON blob. read_csv therefore takes the names from
# row 1 and the data from row 4 onwards.
#
# Q1_1 to Q6_1 are the six sliders in order: mental demand, physical
# demand, temporal demand, performance, effort, frustration.

read_tlx <- function(path, cond, ph) {
  nms <- names(read_csv(path, n_max = 0, show_col_types = FALSE))
  read_csv(path, skip = 3, col_names = nms, show_col_types = FALSE) |>
    transmute(
      condition   = cond,
      phase       = ph,
      mental      = as.numeric(Q1_1),
      physical    = as.numeric(Q2_1),
      temporal    = as.numeric(Q3_1),
      performance = as.numeric(Q4_1),
      effort      = as.numeric(Q5_1),
      frustration = as.numeric(Q6_1)
    ) |>
    filter(!is.na(mental))
}

tlx_dir <- "report/data/sep3"

tlx <- bind_rows(
  read_tlx(file.path(tlx_dir, "no_ai_early.csv"),        "no_ai",     "Early"),
  read_tlx(file.path(tlx_dir, "no_ai_late.csv"),         "no_ai",     "Late"),
  read_tlx(file.path(tlx_dir, "stable_ai_early.csv"),    "stable_ai", "Early"),
  read_tlx(file.path(tlx_dir, "stable_ai_late.csv"),     "stable_ai", "Late"),
  read_tlx(file.path(tlx_dir, "ai_disappear_early.csv"), "disappear", "Early"),
  read_tlx(file.path(tlx_dir, "ai_disappear_late.csv"),  "disappear", "Late")
)

tlx <- mutate(tlx, tlx_raw = rowMeans(across(mental:frustration)))

# Snapshot for reference; the analysis uses the object above.
write_csv(tlx, "error_logs/kv-export/tlx.csv")

tlx$condition <- factor(tlx$condition, levels = c("no_ai", "stable_ai", "disappear"))
tlx$phase     <- factor(tlx$phase, levels = c("Early", "Late"))

nrow(tlx)                        # expect 300
tlx |> count(condition, phase)   # all six cells must read 50

tlx |> group_by(condition, phase) |> summarise(
  n = n(), mean = mean(tlx_raw), sd = sd(tlx_raw), median = median(tlx_raw),
  .groups = "drop"
)

m_tlx <- lm(tlx_raw ~ condition * phase, data = tlx)
anova(m_tlx)
summary(m_tlx)

emm_tlx <- emmeans(m_tlx, ~ condition | phase)
emm_tlx
contrast(emm_tlx, method = "pairwise", adjust = "holm")
confint(contrast(emm_tlx, method = "pairwise", adjust = "holm"))

# Residual diagnostics. This is an lm, not a glmmTMB, so DHARMa is not
# the tool - base R's four plots are. Look for: residuals vs fitted
# with no funnel, a straight QQ line, and no point with high leverage
# AND a large residual. Raw TLX is a bounded 0-100 composite and
# roughly symmetric, so Gaussian should hold.
par(mfrow = c(2, 2)); plot(m_tlx); par(mfrow = c(1, 1))

# Gaussian, so Cohen's d is the appropriate effect size here - unlike
# the ratio-scale DVs above, where the ratio IS the effect size.
eff_size(emm_tlx, sigma = sigma(m_tlx), edf = df.residual(m_tlx))

qE <- plot_paper(emm_tlx, "Workload (NASA-TLX)", "E", "Raw TLX (0-100)")
qE
ggsave("report/figures/panel_E_workload.png", qE, width = 6.2, height = 4, dpi = 300)

# ---- 8b sensitivity --------------------------------------------------
# An lm, so these are differences in TLX points, not ratios. And note
# the framing constraint: Phase is BETWEEN-groups here, so this compares
# survey points, not the same people before and after.
summary(rbind(contrast(emmeans(m_tlx, ~ phase | condition), method = "pairwise")),
        adjust = "holm")


# =====================================================================
# 9. SUPPLEMENTARY - JUNCTIONS PER TRIAL
# =====================================================================
# Not in the original DV list. Added because it is unaffected by the
# cue-reading confound and locates the mechanism: withdrawal
# participants faced 21.9 junctions per trial against no_ai's 13.9.
#
# STATUS: model FAILS diagnostics. TODO: Try nbinom1 + dispformula, then
# Gaussian on log(junctions_passed).
#
# Caveat: partly mechanical - more moves means more junctions - so it
# is not independent evidence from excess_moves, but a decomposition of
# the same behaviour.

m_junc <- glmmTMB(junctions_passed ~ condition * phase + (1 | participant_id),
                  family = nbinom2, dispformula = ~ condition * phase, data = dat)

plot(simulateResiduals(m_junc))   # expected to FAIL - see the note above

m_junc1 <- glmmTMB(junctions_passed ~ condition * phase + (1 | participant_id),
                   family = nbinom1, dispformula = ~ condition * phase, data = dat)

AIC(m_junc, m_junc1)              # same response scale, comparable
plot(simulateResiduals(m_junc1))


# =====================================================================
# 10. SUMMARY TABLE ACROSS DVs
# =====================================================================
# Pull the Condition x Phase row out of a joint_tests result.
grab_interaction <- function(m) {
  jt <- as.data.frame(joint_tests(m))
  r  <- jt[jt[[1]] == "condition:phase", ]
  data.frame(df = r[["df1"]], Chisq = round(r[["Chisq"]], 2),
             p = format.pval(r[["p.value"]], digits = 3, eps = .001))
}

# One Late-phase contrast, oriented so the named group is the numerator.
# `flip = TRUE` inverts the ratio and swaps the interval ends.
#
# Two shapes have to be handled. Most models give a `ratio` column and
# label contrasts "a / b". m_time_lmm does not: emmeans only knows its
# log through update(tran = "log"), so confint() returns log
# DIFFERENCES in an `estimate` column, labelled "a - b". Those need
# exponentiating, and the labels normalising, before anything else.
grab_contrast <- function(emm, want, flip = FALSE) {
  ci <- as.data.frame(confint(contrast(emm, method = "pairwise", adjust = "holm")))
  names(ci)[names(ci) %in% c("asymp.LCL", "lower.CL")] <- "lo"
  names(ci)[names(ci) %in% c("asymp.UCL", "upper.CL")] <- "hi"
  ci$contrast <- gsub(" - ", " / ", as.character(ci$contrast), fixed = TRUE)

  if ("ratio" %in% names(ci)) {
    ci$est <- ci$ratio
  } else {
    ci$est <- exp(ci$estimate); ci$lo <- exp(ci$lo); ci$hi <- exp(ci$hi)
  }

  r <- ci[ci$phase == "Late" & ci$contrast == want, ]
  if (nrow(r) != 1) {
    stop(sprintf("grab_contrast: '%s' matched %d rows. Available: %s",
                 want, nrow(r), paste(unique(ci$contrast), collapse = ", ")))
  }
  est <- r$est; lo <- r$lo; hi <- r$hi
  if (flip) { est <- 1 / est; tmp <- lo; lo <- 1 / hi; hi <- 1 / tmp }
  sprintf("%.2f [%.2f, %.2f]", est, lo, hi)
}

dv_row <- function(label, m, emm) {
  cbind(
    data.frame(DV = label),
    grab_interaction(m),
    data.frame(
      disappear_vs_no_ai  = grab_contrast(emm, "no_ai / disappear",     flip = TRUE),
      disappear_vs_stable = grab_contrast(emm, "stable_ai / disappear", flip = TRUE),
      stable_vs_no_ai     = grab_contrast(emm, "no_ai / stable_ai",     flip = TRUE)
    )
  )
}

ints <- rbind(
  dv_row("Excess moves",    m_zinb_d,   emm),
  dv_row("Completion time", m_time_lmm, emm_time),
  dv_row("Revisits",        m_rev_d,    emm_rev),
  dv_row("Back affordance", m_back_d,   emm_back)
)

# Decision Time is appended by hand because it is a different model
# shape: no interaction and only one valid contrast, both because of
# the cue-reading confound. The two n/a
# cells are a design limitation, not missing work.
dec_ci <- as.data.frame(confint(contrast(emm_dec, method = "pairwise")))
names(dec_ci)[names(dec_ci) %in% c("asymp.LCL", "lower.CL")] <- "lo"
names(dec_ci)[names(dec_ci) %in% c("asymp.UCL", "upper.CL")] <- "hi"
if (!"ratio" %in% names(dec_ci)) {
  dec_ci$ratio <- exp(dec_ci$estimate); dec_ci$lo <- exp(dec_ci$lo); dec_ci$hi <- exp(dec_ci$hi)
}

ints <- rbind(ints, data.frame(
  DV = "Decision time", df = NA, Chisq = NA, p = "n/a",
  disappear_vs_no_ai  = sprintf("%.2f [%.2f, %.2f]",
                                1 / dec_ci$ratio[1], 1 / dec_ci$hi[1], 1 / dec_ci$lo[1]),
  disappear_vs_stable = "n/a",
  stable_vs_no_ai     = "n/a"
))

ints
knitr::kable(ints)

# =====================================================================
# 11. SESSION INFO
# =====================================================================

sessionInfo()
names(as.data.frame(summary(emm_tlx, type = "response")))

# =====================================================================
# 12. PAPER FIGURES - PAIRED PANELS
# =====================================================================
# The individual panels qA to qE are built and exported in their own DV
# sections above, using plot_paper() from the helper block. This section
# only assembles them into the two paired figures for the paper.
#
#   Figure 1 - task performance:    what the cost was
#   Figure 2 - navigation strategy: where it came from
#
# Panel letters come from plot_paper()'s title, so no plot_annotation
# is needed here. Workload (qE) stays a standalone figure - it is a
# different measure type and belongs with the subjective results.

figAB <- qA | qB
figCD <- qC | qD

figAB
figCD

ggsave("report/figures/fig1_performance.png", figAB, width = 12, height = 4.2, dpi = 300)
ggsave("report/figures/fig2_strategy.png",    figCD, width = 12, height = 4.2, dpi = 300)


# =====================================================================
# 15. APPENDIX FIGURES - DHARMa RESIDUAL PANELS
# =====================================================================
# DHARMa's plot() is base graphics, not ggplot, so ggsave() cannot capture
# it. It has to be wrapped in a device. Each call writes the standard two
# panel diagnostic: the QQ plot with the KS, dispersion and outlier tests
# on the left, residual against predicted with the quantile fits on the right.
#
# simulateResiduals() is stochastic, so the seed is fixed. Without it the
# printed test statistics move slightly every run and will not match the
# numbers quoted in the report.

save_dharma <- function(model, file, seed = 1, width = 1800, height = 900, res = 150) {
  set.seed(seed)
  res_obj <- simulateResiduals(model)
  png(file.path("report", "figures", file), width = width, height = height, res = res)
  plot(res_obj)
  dev.off()
  invisible(res_obj)
}

# The four models actually reported. Each is the FINAL specification for
# its DV, which is the one whose diagnostics the report claims all pass.
save_dharma(m_zinb_d,   "dharma_excess.png")
save_dharma(m_time_lmm, "dharma_time.png")
save_dharma(m_rev_d,    "dharma_revisits.png")
save_dharma(m_back_d,   "dharma_back.png")

# Optional: the rejected specifications, if the appendix is to show what a
# failing panel looks like alongside a passing one.
# save_dharma(m_excess, "dharma_excess_rejected.png")
# save_dharma(m_time,   "dharma_time_rejected.png")


# =====================================================================
# 16. FOREST PLOT OF THE LATE-PHASE CONTRASTS
# =====================================================================
# The same numbers as the summary table in section 10, drawn instead of
# tabulated. Ratios go on a log axis because a ratio of 2 and a ratio of
# 0.5 are the same size of effect in opposite directions, and only a log
# axis places them equidistant from the null. The reference line at 1 is
# "no difference": an interval crossing it is not significant.
#
# Depends on the model and emmeans objects from sections 3 to 7, so run
# this after them.

# Numeric twin of grab_contrast() from section 10. Same two shapes handled
# for the same reason (m_time_lmm returns log differences, not ratios), but
# returns the numbers rather than a formatted string.
grab_contrast_num <- function(emm, want, flip = FALSE) {
  ci <- as.data.frame(confint(contrast(emm, method = "pairwise", adjust = "holm")))
  names(ci)[names(ci) %in% c("asymp.LCL", "lower.CL")] <- "lo"
  names(ci)[names(ci) %in% c("asymp.UCL", "upper.CL")] <- "hi"
  ci$contrast <- gsub(" - ", " / ", as.character(ci$contrast), fixed = TRUE)

  if ("ratio" %in% names(ci)) {
    ci$est <- ci$ratio
  } else {
    ci$est <- exp(ci$estimate); ci$lo <- exp(ci$lo); ci$hi <- exp(ci$hi)
  }

  r <- ci[ci$phase == "Late" & ci$contrast == want, ]
  if (nrow(r) != 1) stop(sprintf("grab_contrast_num: '%s' matched %d rows", want, nrow(r)))

  est <- r$est; lo <- r$lo; hi <- r$hi
  if (flip) { est <- 1 / est; tmp <- lo; lo <- 1 / hi; hi <- 1 / tmp }
  data.frame(est = est, lo = lo, hi = hi)
}

forest_rows <- function(label, emm) {
  rbind(
    cbind(DV = label, contrast = "vs no AI",
          grab_contrast_num(emm, "no_ai / disappear", flip = TRUE)),
    cbind(DV = label, contrast = "vs stable AI",
          grab_contrast_num(emm, "stable_ai / disappear", flip = TRUE))
  )
}

fdat <- rbind(
  forest_rows("Excess moves",    emm),
  forest_rows("Completion time", emm_time),
  forest_rows("Revisits",        emm_rev),
  forest_rows("Back affordance", emm_back)
)

# Decision time is appended by hand for the same reason as in section 10:
# only the cue-status-matched contrast is identifiable, so it has one row.
dec_ci <- as.data.frame(confint(contrast(emm_dec, method = "pairwise")))
names(dec_ci)[names(dec_ci) %in% c("asymp.LCL", "lower.CL")] <- "lo"
names(dec_ci)[names(dec_ci) %in% c("asymp.UCL", "upper.CL")] <- "hi"
if (!"ratio" %in% names(dec_ci)) {
  dec_ci$ratio <- exp(dec_ci$estimate); dec_ci$lo <- exp(dec_ci$lo); dec_ci$hi <- exp(dec_ci$hi)
}
fdat <- rbind(fdat, data.frame(
  DV = "Decision time", contrast = "vs no AI",
  est = 1 / dec_ci$ratio[1], lo = 1 / dec_ci$hi[1], hi = 1 / dec_ci$lo[1]
))

# Order top to bottom as the chapter reports them. coord_flip() reverses
# the factor, so the levels are listed in reverse of the reading order.
dv_order <- c("Decision time", "Back affordance", "Revisits",
              "Completion time", "Excess moves")
fdat$DV       <- factor(fdat$DV, levels = dv_order)
fdat$contrast <- factor(fdat$contrast, levels = c("vs no AI", "vs stable AI"))

# An interval crossing 1 is not significant. Marking those rather than
# leaving the reader to check each interval against the reference line.
fdat$sig <- ifelse(fdat$lo > 1 | fdat$hi < 1, "significant", "not significant")

forest <- ggplot(fdat, aes(x = DV, y = est, ymin = lo, ymax = hi,
                           colour = contrast, shape = sig)) +
  geom_hline(yintercept = 1, linetype = "dashed", colour = "grey40") +
  geom_pointrange(position = position_dodge(width = 0.55), fatten = 3, linewidth = 0.9) +
  coord_flip() +
  scale_y_log10(breaks = c(0.5, 1, 2, 5, 10, 20)) +
  scale_shape_manual(values = c("significant" = 16, "not significant" = 1), guide = "none") +
  scale_colour_brewer(palette = "Dark2") +
  labs(x = NULL,
       y = "Ratio, withdrawal group relative to comparison (log scale)",
       colour = NULL) +
  theme_thesis

forest

ggsave("report/figures/fig3_forest.png", forest, width = 9, height = 5, dpi = 300)

# Sanity check against the section 10 table: these should match the
# printed contrasts to two decimals.
print(transform(fdat, est = round(est, 2), lo = round(lo, 2), hi = round(hi, 2)))


# =====================================================================
# 17. TLX SUBSCALE BAR CHART
# =====================================================================
# The six subscales are collected but only tlx_raw is modelled, so this
# is the one figure carrying information the rest of the chapter does
# not. Bars are the right form here: six unordered categories with no
# interaction to read off, which is exactly what a bar chart is for.
#
# Error bars are standard errors of the cell mean. Phase is BETWEEN
# groups for TLX (responses are anonymous), so these are independent
# samples of 50 and the bars compare survey points, never people.

tlx_long <- tlx |>
  select(condition, phase, mental:frustration) |>
  pivot_longer(mental:frustration, names_to = "subscale", values_to = "score") |>
  group_by(condition, phase, subscale) |>
  summarise(n = n(), mean = mean(score), se = sd(score) / sqrt(n()), .groups = "drop")

# Ordered as the instrument presents them, not alphabetically.
tlx_long$subscale <- factor(
  tlx_long$subscale,
  levels = c("mental", "physical", "temporal", "performance", "effort", "frustration"),
  labels = c("Mental", "Physical", "Temporal", "Performance", "Effort", "Frustration")
)
tlx_long$condition <- factor(tlx_long$condition,
                             levels = c("no_ai", "stable_ai", "disappear"),
                             labels = c("No AI", "Stable AI", "AI Disappear"))

subscales <- ggplot(tlx_long, aes(x = subscale, y = mean, fill = phase)) +
  geom_col(position = position_dodge(0.8), width = 0.72) +
  geom_errorbar(aes(ymin = mean - se, ymax = mean + se),
                position = position_dodge(0.8), width = 0.18, linewidth = 0.5) +
  facet_wrap(~ condition) +
  scale_fill_brewer(palette = "Dark2", name = NULL,
                    labels = c("Early (after maze 4)", "Late (after maze 8)")) +
  labs(x = NULL, y = "Reported score (0-100)") +
  theme_thesis +
  theme(axis.text.x = element_text(angle = 40, hjust = 1))

subscales

ggsave("report/figures/fig4_tlx_subscales.png", subscales, width = 11, height = 4.6, dpi = 300)

# The numbers behind it. Watch the Performance column: it is the one
# subscale that does not move for the withdrawal group while the rest
# rise sharply.
tlx_long |>
  mutate(mean = round(mean, 1)) |>
  select(condition, phase, subscale, mean) |>
  pivot_wider(names_from = subscale, values_from = mean) |>
  print(width = Inf)


# =====================================================================
# 18. FOLLOW RATE
# =====================================================================
# followed_cue / junctions_with_a_cue is described in the methodology as
# the study's primary behavioural measure, and is currently not reported
# anywhere. This is the figure for it.
#
# Only cells where a cue was actually shown can appear: no_ai never, and
# disappear only in the Early phase. Three bars, not six, and that
# absence is itself the manipulation.

follow <- jn |>
  filter(cue_shown == 1) |>
  group_by(condition, phase) |>
  summarise(n = n(),
            rate = mean(followed == 1),
            se = sqrt(rate * (1 - rate) / n()),
            .groups = "drop")

follow$cell <- paste(follow$condition, follow$phase, sep = "\n")

p_follow <- ggplot(follow, aes(x = cell, y = rate, fill = condition)) +
  geom_col(width = 0.6) +
  geom_errorbar(aes(ymin = rate - se, ymax = rate + se), width = 0.15, linewidth = 0.5) +
  geom_text(aes(label = sprintf("%.1f%%", 100 * rate)), vjust = -1.4, size = 5) +
  scale_y_continuous(labels = scales::percent, limits = c(0, 1)) +
  scale_fill_brewer(palette = "Dark2", guide = "none") +
  labs(x = NULL, y = "Cues followed") +
  theme_thesis

p_follow

ggsave("report/figures/fig5_follow_rate.png", p_follow, width = 7, height = 4.5, dpi = 300)

follow


# =====================================================================
# 19. ANNOTATED RESULTS MATRIX
# =====================================================================
# Uses unrounded model contrasts directly, including the stable/no-AI
# comparison. No HTML scraping or manually entered estimates are needed.
# Colour encodes the displayed CI's direction, not a p-value or effect size.

comparison_names <- c("AI disappears / No AI", "AI disappears / Stable AI",
                      "Stable AI / No AI")
outcome_names <- c("Excess moves", "Completion time", "Revisits",
                   "Back affordance", "Decision time")

matrix_rows <- function(label, emm_object) {
  bind_rows(
    grab_contrast_num(emm_object, "no_ai / disappear", flip = TRUE),
    grab_contrast_num(emm_object, "stable_ai / disappear", flip = TRUE),
    grab_contrast_num(emm_object, "no_ai / stable_ai", flip = TRUE)
  ) |> mutate(outcome = label, comparison = comparison_names)
}

# The decision-time CI is unadjusted: only one comparable pair exists.
decision_matrix_ci <- as.data.frame(confint(
  contrast(emm_dec, method = "pairwise", adjust = "none")))
stopifnot(nrow(decision_matrix_ci) == 1L)
decision_matrix_contrast <- gsub(" - ", " / ",
  as.character(decision_matrix_ci$contrast), fixed = TRUE)
decision_lower <- intersect(c("asymp.LCL", "lower.CL"), names(decision_matrix_ci))[1]
decision_upper <- intersect(c("asymp.UCL", "upper.CL"), names(decision_matrix_ci))[1]
if ("ratio" %in% names(decision_matrix_ci)) {
  decision_values <- c(decision_matrix_ci$ratio,
    decision_matrix_ci[[decision_lower]], decision_matrix_ci[[decision_upper]])
} else {
  decision_values <- exp(c(decision_matrix_ci$estimate,
    decision_matrix_ci[[decision_lower]], decision_matrix_ci[[decision_upper]]))
}
if (decision_matrix_contrast == "no_ai / disappear") {
  decision_values <- 1 / decision_values[c(1, 3, 2)]
} else {
  stopifnot(decision_matrix_contrast == "disappear / no_ai")
}

matrix_data <- bind_rows(
  matrix_rows("Excess moves", emm),
  matrix_rows("Completion time", emm_time),
  matrix_rows("Revisits", emm_rev),
  matrix_rows("Back affordance", emm_back),
  tibble(outcome = "Decision time", comparison = comparison_names,
    est = c(decision_values[1], NA_real_, NA_real_),
    lo = c(decision_values[2], NA_real_, NA_real_),
    hi = c(decision_values[3], NA_real_, NA_real_))
) |> mutate(
  interpretation = case_when(
    is.na(est) ~ "Not comparable",
    lo > 1 ~ "Higher",
    hi < 1 ~ "Lower",
    TRUE ~ "Inconclusive"),
  number = if_else(is.na(est), "\u2014", sprintf("%.2f\u00d7", est)),
  interval = if_else(is.na(est), "Not comparable",
    sprintf("95%% CI %.2f\u2013%.2f", lo, hi)),
  annotation = case_when(
    interpretation == "Higher" ~ "Higher in the first group",
    interpretation == "Lower" ~ "Lower in the first group",
    interpretation == "Inconclusive" ~ "Interval includes no difference",
    TRUE ~ "Cue-reading confound"),
  x = match(comparison, comparison_names),
  y = 6 - match(outcome, outcome_names)
)

matrix_colours <- c(Higher = "#f7d8c9", Lower = "#d7e9f1",
  Inconclusive = "#f1eee7", "Not comparable" = "#f5f5f5")
annotated_results_matrix <- ggplot(matrix_data, aes(x, y)) +
  geom_tile(aes(fill = interpretation), width = .97, height = .94) +
  geom_text(aes(y = y + .23, label = number), size = 6.5,
            fontface = "bold", colour = "#172b3a") +
  geom_text(aes(label = interval), size = 3.6, colour = "#253c4b") +
  geom_text(aes(y = y - .26, label = annotation), size = 3.1,
            colour = "#46525a") +
  scale_fill_manual(values = matrix_colours, guide = "none") +
  scale_x_continuous(breaks = 1:3, labels = comparison_names,
                     position = "top", expand = expansion(add = .5)) +
  scale_y_continuous(breaks = 1:5, labels = rev(outcome_names),
                     expand = expansion(add = .52)) +
  labs(x = NULL, y = NULL,
    title = "What changes after AI withdrawal?",
    subtitle = "Late-phase planned comparisons \u00b7 model ratios with 95% confidence intervals",
    caption = paste(
      "Ratios above 1 indicate more of the outcome in the first named group; below 1 indicate less.",
      "Colour describes the confidence interval, not effect size. Pairwise CIs are Bonferroni-adjusted within phase;",
      "decision time has one unadjusted comparison. An inconclusive interval does not establish equivalence.",
      sep = "\n")) +
  theme_minimal(base_size = 12) +
  theme(panel.grid = element_blank(), axis.text = element_text(colour = "#172b3a"),
    axis.text.x = element_text(face = "bold", size = 11, margin = margin(b = 12)),
    axis.text.y = element_text(face = "bold", size = 11, margin = margin(r = 12)),
    plot.title = element_text(face = "bold", size = 21, colour = "#172b3a"),
    plot.subtitle = element_text(size = 12, margin = margin(b = 24)),
    plot.caption = element_text(hjust = 0, size = 9, colour = "#46525a",
                                margin = margin(t = 15)),
    plot.title.position = "plot", plot.caption.position = "plot",
    plot.margin = margin(16, 16, 12, 16))

#+ annotated-results-matrix, fig.width=12, fig.height=6.5
print(annotated_results_matrix)
for (extension in c("png", "pdf")) {
  ggsave(paste0("report/figures/annotated_results_matrix.", extension),
    annotated_results_matrix, width = 12, height = 6.5, dpi = 300, bg = "white",
    device = if (extension == "pdf") grDevices::cairo_pdf else "png")
}
matrix_export <- matrix_data |>
  transmute(outcome, comparison, ratio = est, lower = lo, upper = hi, interpretation)
write_csv(matrix_export, "report/figures/annotated_results_matrix.csv")
knitr::kable(matrix_export, digits = 2)

# =====================================================================
# 20. WORKLOAD HEATMAP
# =====================================================================
# Uses the same original survey data as section 8. Early and Late are
# anonymous survey samples, not paired observations. Subscale differences
# are descriptive, with no significance tests implied. Performance is the
# recorded survey score, not objectively measured navigation performance.

workload_dimensions <- c("mental", "physical", "temporal", "performance",
                         "effort", "frustration")
workload_labels <- c("Mental demand", "Physical demand", "Temporal demand",
                     "Performance", "Effort", "Frustration")
workload_conditions <- c("no_ai", "stable_ai", "disappear")
workload_condition_labels <- c("No AI", "Stable AI", "AI disappears")
stopifnot(all(vapply(tlx[workload_dimensions], function(x)
  all(is.na(x) | (is.finite(x) & x >= 0 & x <= 100)), logical(1))))

workload_summary <- tlx |>
  select(condition, phase, all_of(workload_dimensions)) |>
  pivot_longer(all_of(workload_dimensions), names_to = "dimension", values_to = "score") |>
  group_by(condition, phase, dimension) |>
  summarise(n = sum(!is.na(score)),
    mean = if (all(is.na(score))) NA_real_ else mean(score, na.rm = TRUE),
    .groups = "drop") |>
  pivot_wider(names_from = phase, values_from = c(mean, n)) |>
  mutate(difference = mean_Late - mean_Early,
    dimension = factor(dimension, levels = workload_dimensions, labels = workload_labels),
    condition = factor(condition, levels = workload_conditions,
                       labels = workload_condition_labels)) |>
  arrange(condition, dimension)
stopifnot(nrow(workload_summary) == 18L, !anyNA(workload_summary))

workload_tiles <- workload_summary |>
  transmute(condition, dimension, Early = mean_Early, Late = mean_Late,
            Difference = difference) |>
  pivot_longer(Early:Difference, names_to = "column", values_to = "score") |>
  mutate(x = match(column, c("Early", "Late", "Difference")),
         y = 7 - as.integer(dimension))
difference_limit <- max(5, ceiling(max(abs(workload_summary$difference)) / 5) * 5)
score_colours <- scales::col_numeric(c("#f3f7fa", "#a7c5d7", "#315b78"), domain = c(0, 100))
difference_colours <- scales::col_numeric(c("#337a9e", "#faf7f2", "#bf5c37"),
                                          domain = c(-difference_limit, difference_limit))
# Apply each scale only to its own columns to avoid out-of-range warnings.
workload_tiles$fill <- NA_character_
is_difference <- workload_tiles$column == "Difference"
workload_tiles$fill[!is_difference] <- score_colours(workload_tiles$score[!is_difference])
workload_tiles$fill[is_difference] <- difference_colours(workload_tiles$score[is_difference])
rgb_values <- grDevices::col2rgb(workload_tiles$fill) / 255
workload_tiles$text_colour <- ifelse(
  as.numeric(c(.2126, .7152, .0722) %*% rgb_values) < .52, "white", "#172b3a")
workload_tiles$label <- ifelse(is_difference,
  sprintf("%+.1f", workload_tiles$score), sprintf("%.1f", workload_tiles$score))

workload_panel <- ggplot(workload_tiles, aes(x, y)) +
  geom_tile(aes(fill = fill), width = .96, height = .95) +
  geom_text(aes(label = label, colour = text_colour,
                fontface = ifelse(column == "Difference", "bold", "plain")), size = 4.3) +
  facet_wrap(~ condition, nrow = 1) +
  scale_fill_identity() + scale_colour_identity() +
  scale_x_continuous(breaks = 1:3, labels = c("Early", "Late", "\u0394 Late \u2212 Early"),
                     position = "top", expand = expansion(add = .5)) +
  scale_y_continuous(breaks = 1:6, labels = rev(workload_labels),
                     expand = expansion(add = .5)) +
  labs(x = NULL, y = NULL) +
  theme_minimal(base_size = 12) +
  theme(panel.grid = element_blank(),
    axis.text = element_text(colour = "#172b3a"),
    axis.text.x = element_text(size = 10, margin = margin(b = 8)),
    axis.text.y = element_text(size = 11, margin = margin(r = 8)),
    strip.text = element_text(face = "bold", size = 13, margin = margin(b = 14)),
    panel.spacing.x = unit(18, "pt"), plot.margin = margin(5, 10, 0, 10))

heatmap_key <- function(limits, colours, title) {
  ggplot(tibble(value = seq(limits[1], limits[2], length.out = 256)),
         aes(value, 1, fill = value)) +
    geom_tile(width = diff(limits) / 255, height = 1) +
    scale_fill_gradientn(colours = colours, limits = limits, guide = "none") +
    scale_x_continuous(breaks = c(limits[1], mean(limits), limits[2]),
                       expand = expansion(mult = 0)) +
    labs(title = title, x = NULL, y = NULL) +
    theme_void(base_size = 10) +
    theme(axis.text.x = element_text(colour = "#172b3a"),
      plot.title = element_text(size = 10, hjust = .5),
      plot.margin = margin(10, 45, 5, 45))
}
heatmap_keys <- heatmap_key(c(0, 100), c("#f3f7fa", "#a7c5d7", "#315b78"),
                            "Mean reported score (0\u2013100)") |
  heatmap_key(c(-difference_limit, difference_limit), c("#337a9e", "#faf7f2", "#bf5c37"),
              "Difference in points (Late \u2212 Early)")
survey_counts <- unique(c(workload_summary$n_Early, workload_summary$n_Late))
workload_subtitle <- if (length(survey_counts) == 1) {
  sprintf("NASA-TLX subscale means \u00b7 %d survey responses per condition and phase",
          survey_counts)
} else {
  "NASA-TLX subscale means \u00b7 sample sizes are reported in the accompanying table"
}
workload_heatmap <- (workload_panel / heatmap_keys) +
  plot_layout(heights = c(12, 1.2)) +
  plot_annotation(
    title = "Which parts of workload changed?", subtitle = workload_subtitle,
    caption = paste(
      "Descriptive comparisons between anonymous survey samples, not paired changes or subscale significance tests.",
      "Performance is the recorded self-report score. Differences are calculated before rounding.", sep = "\n"),
    theme = theme(
      plot.title = element_text(face = "bold", size = 21, colour = "#172b3a"),
      plot.subtitle = element_text(size = 12, colour = "#46525a", margin = margin(b = 14)),
      plot.caption = element_text(size = 9, hjust = 0, colour = "#46525a", margin = margin(t = 12)),
      plot.margin = margin(16, 16, 12, 16)))

#+ workload-heatmap, fig.width=12, fig.height=6.7
print(workload_heatmap)
for (extension in c("png", "pdf")) {
  ggsave(paste0("report/figures/workload_heatmap.", extension),
    workload_heatmap, width = 12, height = 6.7, dpi = 300, bg = "white",
    device = if (extension == "pdf") grDevices::cairo_pdf else "png")
}
workload_export <- workload_summary |>
  transmute(condition, dimension, early = mean_Early, late = mean_Late,
            difference, n_early = n_Early, n_late = n_Late)
write_csv(workload_export, "report/figures/workload_heatmap.csv")
knitr::kable(workload_export, digits = 1)
