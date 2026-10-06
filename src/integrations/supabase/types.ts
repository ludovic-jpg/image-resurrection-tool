export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      coffre_fichier: {
        Row: {
          categorie: string
          chemin: string
          cree_le: string
          description: string
          formateur_id: string
          formation_id: string
          id: string
          nom_fichier: string
          of_id: string
          origine: string
          partageable: boolean
          supprime_le: string | null
          taille: number
          type_mime: string
        }
        Insert: {
          categorie?: string
          chemin: string
          cree_le?: string
          description?: string
          formateur_id: string
          formation_id: string
          id?: string
          nom_fichier: string
          of_id: string
          origine?: string
          partageable?: boolean
          supprime_le?: string | null
          taille: number
          type_mime?: string
        }
        Update: {
          categorie?: string
          chemin?: string
          cree_le?: string
          description?: string
          formateur_id?: string
          formation_id?: string
          id?: string
          nom_fichier?: string
          of_id?: string
          origine?: string
          partageable?: boolean
          supprime_le?: string | null
          taille?: number
          type_mime?: string
        }
        Relationships: [
          {
            foreignKeyName: "coffre_fichier_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coffre_fichier_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coffre_fichier_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      compteur: {
        Row: {
          cle: string
          of_id: string
          valeur: number
        }
        Insert: {
          cle: string
          of_id: string
          valeur?: number
        }
        Update: {
          cle?: string
          of_id?: string
          valeur?: number
        }
        Relationships: [
          {
            foreignKeyName: "compteur_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      courrier: {
        Row: {
          corps_html: string
          cree_le: string
          destinataire: string
          dossier_id: string | null
          erreur: string
          formateur_id: string | null
          id: string
          of_id: string
          pieces_jointes: Json
          statut: string
          sujet: string
          type: string
        }
        Insert: {
          corps_html: string
          cree_le?: string
          destinataire: string
          dossier_id?: string | null
          erreur?: string
          formateur_id?: string | null
          id?: string
          of_id: string
          pieces_jointes?: Json
          statut?: string
          sujet: string
          type: string
        }
        Update: {
          corps_html?: string
          cree_le?: string
          destinataire?: string
          dossier_id?: string | null
          erreur?: string
          formateur_id?: string | null
          id?: string
          of_id?: string
          pieces_jointes?: Json
          statut?: string
          sujet?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "courrier_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courrier_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_formation: {
        Row: {
          archive_le: string | null
          coffre_ouvert: boolean
          cree_le: string
          dossier_reference: string
          entreprise_id: string
          formateur_cout_horaire: number | null
          formateur_id: string
          formation_date_debut: string
          formation_date_fin: string
          formation_duree_heures_distanciel: number | null
          formation_duree_heures_presentiel: number | null
          formation_duree_heures_total: number | null
          formation_duree_jours: number | null
          formation_id: string | null
          formation_lien_visio: string
          formation_lieu_adresse: string
          formation_lieu_nom: string
          formation_lieu_siret: string
          formation_modalite: string
          formation_niveau: string
          formation_objectifs: string
          formation_objectifs_atteints: string
          formation_opco: string
          formation_prerequis: string
          formation_prix_presentiel_ht: number | null
          formation_prix_unitaire_ht: number | null
          formation_programme: string
          formation_public_vise: string
          formation_titre: string
          id: string
          maj_le: string
          mode_financement: string
          motif_refus: string
          motif_renvoi: string
          of_id: string
          questionnaire_acquis: Json | null
          questionnaire_positionnement: Json | null
          signature_lieu: string
          sous_statut: string
          termine_le: string | null
          valide_le: string | null
        }
        Insert: {
          archive_le?: string | null
          coffre_ouvert?: boolean
          cree_le?: string
          dossier_reference: string
          entreprise_id: string
          formateur_cout_horaire?: number | null
          formateur_id: string
          formation_date_debut?: string
          formation_date_fin?: string
          formation_duree_heures_distanciel?: number | null
          formation_duree_heures_presentiel?: number | null
          formation_duree_heures_total?: number | null
          formation_duree_jours?: number | null
          formation_id?: string | null
          formation_lien_visio?: string
          formation_lieu_adresse?: string
          formation_lieu_nom?: string
          formation_lieu_siret?: string
          formation_modalite?: string
          formation_niveau?: string
          formation_objectifs?: string
          formation_objectifs_atteints?: string
          formation_opco?: string
          formation_prerequis?: string
          formation_prix_presentiel_ht?: number | null
          formation_prix_unitaire_ht?: number | null
          formation_programme?: string
          formation_public_vise?: string
          formation_titre?: string
          id?: string
          maj_le?: string
          mode_financement?: string
          motif_refus?: string
          motif_renvoi?: string
          of_id: string
          questionnaire_acquis?: Json | null
          questionnaire_positionnement?: Json | null
          signature_lieu?: string
          sous_statut?: string
          termine_le?: string | null
          valide_le?: string | null
        }
        Update: {
          archive_le?: string | null
          coffre_ouvert?: boolean
          cree_le?: string
          dossier_reference?: string
          entreprise_id?: string
          formateur_cout_horaire?: number | null
          formateur_id?: string
          formation_date_debut?: string
          formation_date_fin?: string
          formation_duree_heures_distanciel?: number | null
          formation_duree_heures_presentiel?: number | null
          formation_duree_heures_total?: number | null
          formation_duree_jours?: number | null
          formation_id?: string | null
          formation_lien_visio?: string
          formation_lieu_adresse?: string
          formation_lieu_nom?: string
          formation_lieu_siret?: string
          formation_modalite?: string
          formation_niveau?: string
          formation_objectifs?: string
          formation_objectifs_atteints?: string
          formation_opco?: string
          formation_prerequis?: string
          formation_prix_presentiel_ht?: number | null
          formation_prix_unitaire_ht?: number | null
          formation_programme?: string
          formation_public_vise?: string
          formation_titre?: string
          id?: string
          maj_le?: string
          mode_financement?: string
          motif_refus?: string
          motif_renvoi?: string
          of_id?: string
          questionnaire_acquis?: Json | null
          questionnaire_positionnement?: Json | null
          signature_lieu?: string
          sous_statut?: string
          termine_le?: string | null
          valide_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dossier_formation_entreprise_id_fkey"
            columns: ["entreprise_id"]
            isOneToOne: false
            referencedRelation: "entreprise_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_formation_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_formation_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_formation_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      emargement: {
        Row: {
          horodatage: string
          id: string
          seance_id: string
          signataire: string
          stagiaire_id: string
          trace_png: string
        }
        Insert: {
          horodatage?: string
          id?: string
          seance_id: string
          signataire: string
          stagiaire_id: string
          trace_png: string
        }
        Update: {
          horodatage?: string
          id?: string
          seance_id?: string
          signataire?: string
          stagiaire_id?: string
          trace_png?: string
        }
        Relationships: [
          {
            foreignKeyName: "emargement_seance_id_fkey"
            columns: ["seance_id"]
            isOneToOne: false
            referencedRelation: "seance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emargement_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      entreprise_cliente: {
        Row: {
          archive_le: string | null
          cree_le: string
          entreprise_adresse: string
          entreprise_nom: string
          entreprise_nom_commercial: string
          entreprise_opco: string
          entreprise_representant_civilite: string
          entreprise_representant_email: string
          entreprise_representant_nom: string
          entreprise_representant_prenom: string
          entreprise_representant_telephone: string
          entreprise_siret: string
          formateur_id: string
          id: string
          of_id: string
        }
        Insert: {
          archive_le?: string | null
          cree_le?: string
          entreprise_adresse?: string
          entreprise_nom?: string
          entreprise_nom_commercial?: string
          entreprise_opco?: string
          entreprise_representant_civilite?: string
          entreprise_representant_email?: string
          entreprise_representant_nom?: string
          entreprise_representant_prenom?: string
          entreprise_representant_telephone?: string
          entreprise_siret?: string
          formateur_id: string
          id?: string
          of_id: string
        }
        Update: {
          archive_le?: string | null
          cree_le?: string
          entreprise_adresse?: string
          entreprise_nom?: string
          entreprise_nom_commercial?: string
          entreprise_opco?: string
          entreprise_representant_civilite?: string
          entreprise_representant_email?: string
          entreprise_representant_nom?: string
          entreprise_representant_prenom?: string
          entreprise_representant_telephone?: string
          entreprise_siret?: string
          formateur_id?: string
          id?: string
          of_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entreprise_cliente_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entreprise_cliente_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation: {
        Row: {
          ajustement: string
          cree_le: string
          date: string
          dossier_id: string
          id: string
          reponses: Json
          saisie_par: string | null
          score: number | null
          stagiaire_id: string
          type: string
        }
        Insert: {
          ajustement?: string
          cree_le?: string
          date: string
          dossier_id: string
          id?: string
          reponses: Json
          saisie_par?: string | null
          score?: number | null
          stagiaire_id: string
          type: string
        }
        Update: {
          ajustement?: string
          cree_le?: string
          date?: string
          dossier_id?: string
          id?: string
          reponses?: Json
          saisie_par?: string | null
          score?: number | null
          stagiaire_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      evenement: {
        Row: {
          acteur_id: string | null
          acteur_role: string
          cree_le: string
          detail: Json | null
          dossier_id: string | null
          id: string
          libelle: string
          of_id: string
          type: string
        }
        Insert: {
          acteur_id?: string | null
          acteur_role: string
          cree_le?: string
          detail?: Json | null
          dossier_id?: string | null
          id?: string
          libelle: string
          of_id: string
          type: string
        }
        Update: {
          acteur_id?: string | null
          acteur_role?: string
          cree_le?: string
          detail?: Json | null
          dossier_id?: string | null
          id?: string
          libelle?: string
          of_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "evenement_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenement_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      facture_formateur: {
        Row: {
          dossier_id: string
          facture_formateur_date: string
          facture_formateur_numero: string
          id: string
        }
        Insert: {
          dossier_id: string
          facture_formateur_date: string
          facture_formateur_numero: string
          id?: string
        }
        Update: {
          dossier_id?: string
          facture_formateur_date?: string
          facture_formateur_numero?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facture_formateur_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: true
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      facture_of: {
        Row: {
          dossier_id: string
          facture_of_acompte: number | null
          facture_of_code_client: string
          facture_of_date: string
          facture_of_numero: string
          facture_of_numero_adherent: string
          id: string
        }
        Insert: {
          dossier_id: string
          facture_of_acompte?: number | null
          facture_of_code_client?: string
          facture_of_date: string
          facture_of_numero: string
          facture_of_numero_adherent?: string
          id?: string
        }
        Update: {
          dossier_id?: string
          facture_of_acompte?: number | null
          facture_of_code_client?: string
          facture_of_date?: string
          facture_of_numero?: string
          facture_of_numero_adherent?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facture_of_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: true
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      formateur: {
        Row: {
          anonymise_le: string | null
          cree_le: string
          decidee_le: string | null
          formateur_assurance_rc: string
          formateur_bic: string
          formateur_bio: string
          formateur_disponibilites: string
          formateur_domaines: Json
          formateur_dreets_region: string
          formateur_email: string
          formateur_entreprise_adresse: string
          formateur_entreprise_nom: string
          formateur_entreprise_siret: string
          formateur_iban: string
          formateur_langues: string
          formateur_linkedin: string
          formateur_nda_numero: string
          formateur_nom: string
          formateur_prenom: string
          formateur_statut_juridique: string
          formateur_tarif_journalier: number | null
          formateur_telephone: string
          formateur_zones: string
          id: string
          motif_decision: string
          of_id: string
          parcours: string
          soumise_le: string | null
          statut_candidature: string
          utilisateur_id: string | null
        }
        Insert: {
          anonymise_le?: string | null
          cree_le?: string
          decidee_le?: string | null
          formateur_assurance_rc?: string
          formateur_bic?: string
          formateur_bio?: string
          formateur_disponibilites?: string
          formateur_domaines?: Json
          formateur_dreets_region?: string
          formateur_email?: string
          formateur_entreprise_adresse?: string
          formateur_entreprise_nom?: string
          formateur_entreprise_siret?: string
          formateur_iban?: string
          formateur_langues?: string
          formateur_linkedin?: string
          formateur_nda_numero?: string
          formateur_nom?: string
          formateur_prenom?: string
          formateur_statut_juridique?: string
          formateur_tarif_journalier?: number | null
          formateur_telephone?: string
          formateur_zones?: string
          id?: string
          motif_decision?: string
          of_id: string
          parcours?: string
          soumise_le?: string | null
          statut_candidature?: string
          utilisateur_id?: string | null
        }
        Update: {
          anonymise_le?: string | null
          cree_le?: string
          decidee_le?: string | null
          formateur_assurance_rc?: string
          formateur_bic?: string
          formateur_bio?: string
          formateur_disponibilites?: string
          formateur_domaines?: Json
          formateur_dreets_region?: string
          formateur_email?: string
          formateur_entreprise_adresse?: string
          formateur_entreprise_nom?: string
          formateur_entreprise_siret?: string
          formateur_iban?: string
          formateur_langues?: string
          formateur_linkedin?: string
          formateur_nda_numero?: string
          formateur_nom?: string
          formateur_prenom?: string
          formateur_statut_juridique?: string
          formateur_tarif_journalier?: number | null
          formateur_telephone?: string
          formateur_zones?: string
          id?: string
          motif_decision?: string
          of_id?: string
          parcours?: string
          soumise_le?: string | null
          statut_candidature?: string
          utilisateur_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formateur_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formateur_utilisateur_id_fkey"
            columns: ["utilisateur_id"]
            isOneToOne: false
            referencedRelation: "utilisateur"
            referencedColumns: ["id"]
          },
        ]
      }
      formation: {
        Row: {
          archivee: boolean
          archivee_le: string | null
          cree_le: string
          dossier_enjeux: Json | null
          enjeux_le: string | null
          formateur_cout_horaire: number | null
          formateur_id: string
          formation_accessibilite: string
          formation_delai_acces: string
          formation_domaine: string
          formation_duree_heures_distanciel: number | null
          formation_duree_heures_presentiel: number | null
          formation_duree_heures_total: number | null
          formation_duree_jours: number | null
          formation_effectif_max: number | null
          formation_effectif_min: number | null
          formation_lien_visio: string
          formation_lieu_adresse: string
          formation_lieu_nom: string
          formation_lieu_siret: string
          formation_modalite: string
          formation_modalites_evaluation: string
          formation_modalites_sanction: string
          formation_modules: Json
          formation_moyens_pedagogiques: string
          formation_nb_modules: number | null
          formation_niveau: string
          formation_objectifs: string
          formation_opco: string
          formation_prerequis: string
          formation_prix_groupe_ht: number | null
          formation_prix_unitaire_ht: number | null
          formation_titre: string
          id: string
          maj_le: string
          mode_financement: string
          of_id: string
          programme: string
          public_vise: string
        }
        Insert: {
          archivee?: boolean
          archivee_le?: string | null
          cree_le?: string
          dossier_enjeux?: Json | null
          enjeux_le?: string | null
          formateur_cout_horaire?: number | null
          formateur_id: string
          formation_accessibilite?: string
          formation_delai_acces?: string
          formation_domaine?: string
          formation_duree_heures_distanciel?: number | null
          formation_duree_heures_presentiel?: number | null
          formation_duree_heures_total?: number | null
          formation_duree_jours?: number | null
          formation_effectif_max?: number | null
          formation_effectif_min?: number | null
          formation_lien_visio?: string
          formation_lieu_adresse?: string
          formation_lieu_nom?: string
          formation_lieu_siret?: string
          formation_modalite?: string
          formation_modalites_evaluation?: string
          formation_modalites_sanction?: string
          formation_modules?: Json
          formation_moyens_pedagogiques?: string
          formation_nb_modules?: number | null
          formation_niveau?: string
          formation_objectifs?: string
          formation_opco?: string
          formation_prerequis?: string
          formation_prix_groupe_ht?: number | null
          formation_prix_unitaire_ht?: number | null
          formation_titre?: string
          id?: string
          maj_le?: string
          mode_financement?: string
          of_id: string
          programme?: string
          public_vise?: string
        }
        Update: {
          archivee?: boolean
          archivee_le?: string | null
          cree_le?: string
          dossier_enjeux?: Json | null
          enjeux_le?: string | null
          formateur_cout_horaire?: number | null
          formateur_id?: string
          formation_accessibilite?: string
          formation_delai_acces?: string
          formation_domaine?: string
          formation_duree_heures_distanciel?: number | null
          formation_duree_heures_presentiel?: number | null
          formation_duree_heures_total?: number | null
          formation_duree_jours?: number | null
          formation_effectif_max?: number | null
          formation_effectif_min?: number | null
          formation_lien_visio?: string
          formation_lieu_adresse?: string
          formation_lieu_nom?: string
          formation_lieu_siret?: string
          formation_modalite?: string
          formation_modalites_evaluation?: string
          formation_modalites_sanction?: string
          formation_modules?: Json
          formation_moyens_pedagogiques?: string
          formation_nb_modules?: number | null
          formation_niveau?: string
          formation_objectifs?: string
          formation_opco?: string
          formation_prerequis?: string
          formation_prix_groupe_ht?: number | null
          formation_prix_unitaire_ht?: number | null
          formation_titre?: string
          id?: string
          maj_le?: string
          mode_financement?: string
          of_id?: string
          programme?: string
          public_vise?: string
        }
        Relationships: [
          {
            foreignKeyName: "formation_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formation_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      formulaire_apprenant: {
        Row: {
          brouillon: Json | null
          chemin_invitation: string | null
          cree_le: string
          dossier_id: string
          envois: number
          envoye_le: string | null
          expire_le: string
          id: string
          jeton_hash: string
          of_id: string
          signe_le: string | null
          stagiaire_id: string
          statut: string
          type: string
        }
        Insert: {
          brouillon?: Json | null
          chemin_invitation?: string | null
          cree_le?: string
          dossier_id: string
          envois?: number
          envoye_le?: string | null
          expire_le: string
          id?: string
          jeton_hash: string
          of_id: string
          signe_le?: string | null
          stagiaire_id: string
          statut?: string
          type: string
        }
        Update: {
          brouillon?: Json | null
          chemin_invitation?: string | null
          cree_le?: string
          dossier_id?: string
          envois?: number
          envoye_le?: string | null
          expire_le?: string
          id?: string
          jeton_hash?: string
          of_id?: string
          signe_le?: string | null
          stagiaire_id?: string
          statut?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulaire_apprenant_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulaire_apprenant_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulaire_apprenant_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation: {
        Row: {
          cree_le: string
          email: string
          expire_le: string
          formateur_id: string | null
          jeton_hash: string
          nom: string
          of_id: string
          prenom: string
          role: string
          stagiaire_id: string | null
          utilisateur_id: string | null
          utilisee_le: string | null
        }
        Insert: {
          cree_le?: string
          email: string
          expire_le: string
          formateur_id?: string | null
          jeton_hash: string
          nom?: string
          of_id: string
          prenom?: string
          role: string
          stagiaire_id?: string | null
          utilisateur_id?: string | null
          utilisee_le?: string | null
        }
        Update: {
          cree_le?: string
          email?: string
          expire_le?: string
          formateur_id?: string | null
          jeton_hash?: string
          nom?: string
          of_id?: string
          prenom?: string
          role?: string
          stagiaire_id?: string | null
          utilisateur_id?: string | null
          utilisee_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitation_formateur_id_fk"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_stagiaire_id_fk"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_utilisateur_id_fkey"
            columns: ["utilisateur_id"]
            isOneToOne: false
            referencedRelation: "utilisateur"
            referencedColumns: ["id"]
          },
        ]
      }
      modele_outil: {
        Row: {
          archive_le: string | null
          contenu: Json
          cree_le: string
          formateur_id: string
          formation_id: string | null
          id: string
          maj_le: string
          of_id: string
          titre: string
          type: string
        }
        Insert: {
          archive_le?: string | null
          contenu: Json
          cree_le?: string
          formateur_id: string
          formation_id?: string | null
          id?: string
          maj_le?: string
          of_id: string
          titre?: string
          type: string
        }
        Update: {
          archive_le?: string | null
          contenu?: Json
          cree_le?: string
          formateur_id?: string
          formation_id?: string | null
          id?: string
          maj_le?: string
          of_id?: string
          titre?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "modele_outil_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modele_outil_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modele_outil_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      organisme_formation: {
        Row: {
          conservation_annees: number
          couleur: string
          cree_le: string
          delai_paiement_jours: number
          formation_clause_subrogation: string
          id: string
          of_adresse: string
          of_banque_nom: string
          of_bic: string
          of_certification_complementaire_numero: string
          of_dreets_region: string
          of_email_comptabilite: string
          of_email_pedagogie: string
          of_forme_juridique: string
          of_iban: string
          of_nda_numero: string
          of_nom: string
          of_qualiopi_numero: string
          of_representant_civilite: string
          of_representant_nom: string
          of_representant_prenom: string
          of_siret: string
          of_telephone: string
          of_tribunal_competent: string
          of_tva_intracom: string
          portage_commission_pourcentage: number
          signature_representant_png: string
          tva_pourcentage: number
        }
        Insert: {
          conservation_annees?: number
          couleur?: string
          cree_le?: string
          delai_paiement_jours?: number
          formation_clause_subrogation?: string
          id?: string
          of_adresse?: string
          of_banque_nom?: string
          of_bic?: string
          of_certification_complementaire_numero?: string
          of_dreets_region?: string
          of_email_comptabilite?: string
          of_email_pedagogie?: string
          of_forme_juridique?: string
          of_iban?: string
          of_nda_numero?: string
          of_nom?: string
          of_qualiopi_numero?: string
          of_representant_civilite?: string
          of_representant_nom?: string
          of_representant_prenom?: string
          of_siret?: string
          of_telephone?: string
          of_tribunal_competent?: string
          of_tva_intracom?: string
          portage_commission_pourcentage?: number
          signature_representant_png?: string
          tva_pourcentage?: number
        }
        Update: {
          conservation_annees?: number
          couleur?: string
          cree_le?: string
          delai_paiement_jours?: number
          formation_clause_subrogation?: string
          id?: string
          of_adresse?: string
          of_banque_nom?: string
          of_bic?: string
          of_certification_complementaire_numero?: string
          of_dreets_region?: string
          of_email_comptabilite?: string
          of_email_pedagogie?: string
          of_forme_juridique?: string
          of_iban?: string
          of_nda_numero?: string
          of_nom?: string
          of_qualiopi_numero?: string
          of_representant_civilite?: string
          of_representant_nom?: string
          of_representant_prenom?: string
          of_siret?: string
          of_telephone?: string
          of_tribunal_competent?: string
          of_tva_intracom?: string
          portage_commission_pourcentage?: number
          signature_representant_png?: string
          tva_pourcentage?: number
        }
        Relationships: []
      }
      piece_dossier: {
        Row: {
          chemin_depart: string | null
          chemin_retour: string | null
          code: string
          dossier_id: string
          empreinte_depart: string | null
          empreinte_retour: string | null
          genere_le: string | null
          id: string
          mode_retour: string | null
          nom_fichier_retour: string | null
          retour_le: string | null
          retour_par: string | null
          stagiaire_id: string | null
          statut: string
          transmise_le: string | null
        }
        Insert: {
          chemin_depart?: string | null
          chemin_retour?: string | null
          code: string
          dossier_id: string
          empreinte_depart?: string | null
          empreinte_retour?: string | null
          genere_le?: string | null
          id?: string
          mode_retour?: string | null
          nom_fichier_retour?: string | null
          retour_le?: string | null
          retour_par?: string | null
          stagiaire_id?: string | null
          statut?: string
          transmise_le?: string | null
        }
        Update: {
          chemin_depart?: string | null
          chemin_retour?: string | null
          code?: string
          dossier_id?: string
          empreinte_depart?: string | null
          empreinte_retour?: string | null
          genere_le?: string | null
          id?: string
          mode_retour?: string | null
          nom_fichier_retour?: string | null
          retour_le?: string | null
          retour_par?: string | null
          stagiaire_id?: string | null
          statut?: string
          transmise_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "piece_dossier_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_dossier_retour_par_fkey"
            columns: ["retour_par"]
            isOneToOne: false
            referencedRelation: "utilisateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_dossier_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      piece_formateur: {
        Row: {
          chemin: string
          cree_le: string
          expire_le: string
          formateur_id: string
          id: string
          nom_fichier: string
          taille: number
          type: string
        }
        Insert: {
          chemin: string
          cree_le?: string
          expire_le?: string
          formateur_id: string
          id?: string
          nom_fichier: string
          taille: number
          type: string
        }
        Update: {
          chemin?: string
          cree_le?: string
          expire_le?: string
          formateur_id?: string
          id?: string
          nom_fichier?: string
          taille?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "piece_formateur_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
        ]
      }
      positionnement: {
        Row: {
          archive_le: string | null
          brouillon: Json | null
          chemin_pdf: string | null
          cree_le: string
          date_reponse: string
          empreinte_pdf: string | null
          envoye_le: string | null
          expire_le: string
          formateur_id: string
          formation_id: string | null
          formation_titre: string
          id: string
          jeton_hash: string
          message: string
          of_id: string
          questionnaire: Json | null
          questions_recueil: Json
          recueil: Json | null
          reponses: Json | null
          score: number | null
          signature_lieu: string
          signature_png: string
          signe_le: string | null
          stagiaire_id: string
          statut: string
        }
        Insert: {
          archive_le?: string | null
          brouillon?: Json | null
          chemin_pdf?: string | null
          cree_le?: string
          date_reponse?: string
          empreinte_pdf?: string | null
          envoye_le?: string | null
          expire_le: string
          formateur_id: string
          formation_id?: string | null
          formation_titre?: string
          id?: string
          jeton_hash: string
          message?: string
          of_id: string
          questionnaire?: Json | null
          questions_recueil?: Json
          recueil?: Json | null
          reponses?: Json | null
          score?: number | null
          signature_lieu?: string
          signature_png?: string
          signe_le?: string | null
          stagiaire_id: string
          statut?: string
        }
        Update: {
          archive_le?: string | null
          brouillon?: Json | null
          chemin_pdf?: string | null
          cree_le?: string
          date_reponse?: string
          empreinte_pdf?: string | null
          envoye_le?: string | null
          expire_le?: string
          formateur_id?: string
          formation_id?: string | null
          formation_titre?: string
          id?: string
          jeton_hash?: string
          message?: string
          of_id?: string
          questionnaire?: Json | null
          questions_recueil?: Json
          recueil?: Json | null
          reponses?: Json | null
          score?: number | null
          signature_lieu?: string
          signature_png?: string
          signe_le?: string | null
          stagiaire_id?: string
          statut?: string
        }
        Relationships: [
          {
            foreignKeyName: "positionnement_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positionnement_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positionnement_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positionnement_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      reglage: {
        Row: {
          cle: string
          id: string
          maj_le: string
          of_id: string
          secret: boolean
          valeur: string
        }
        Insert: {
          cle: string
          id?: string
          maj_le?: string
          of_id: string
          secret?: boolean
          valeur?: string
        }
        Update: {
          cle?: string
          id?: string
          maj_le?: string
          of_id?: string
          secret?: boolean
          valeur?: string
        }
        Relationships: [
          {
            foreignKeyName: "reglage_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      seance: {
        Row: {
          date: string
          dossier_id: string
          heure_debut: string
          heure_fin: string
          id: string
        }
        Insert: {
          date: string
          dossier_id: string
          heure_debut: string
          heure_fin: string
          id?: string
        }
        Update: {
          date?: string
          dossier_id?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seance_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      signature: {
        Row: {
          adresse_ip: string
          empreinte_document: string
          horodatage: string
          id: string
          lieu: string
          piece_id: string
          signataire_email: string
          signataire_nom: string
          signataire_role: string
          trace_png: string
          utilisateur_id: string | null
          zone: string
        }
        Insert: {
          adresse_ip?: string
          empreinte_document: string
          horodatage: string
          id?: string
          lieu: string
          piece_id: string
          signataire_email: string
          signataire_nom: string
          signataire_role: string
          trace_png: string
          utilisateur_id?: string | null
          zone: string
        }
        Update: {
          adresse_ip?: string
          empreinte_document?: string
          horodatage?: string
          id?: string
          lieu?: string
          piece_id?: string
          signataire_email?: string
          signataire_nom?: string
          signataire_role?: string
          trace_png?: string
          utilisateur_id?: string | null
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "signature_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: false
            referencedRelation: "piece_dossier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_utilisateur_id_fkey"
            columns: ["utilisateur_id"]
            isOneToOne: false
            referencedRelation: "utilisateur"
            referencedColumns: ["id"]
          },
        ]
      }
      stagiaire: {
        Row: {
          archive_le: string | null
          cree_le: string
          entreprise_id: string | null
          formateur_id: string
          id: string
          of_id: string
          stagiaire_email: string
          stagiaire_nom: string
          stagiaire_poste: string
          stagiaire_prenom: string
          stagiaire_situation_handicap: string
          stagiaire_telephone: string
          utilisateur_id: string | null
        }
        Insert: {
          archive_le?: string | null
          cree_le?: string
          entreprise_id?: string | null
          formateur_id: string
          id?: string
          of_id: string
          stagiaire_email?: string
          stagiaire_nom?: string
          stagiaire_poste?: string
          stagiaire_prenom?: string
          stagiaire_situation_handicap?: string
          stagiaire_telephone?: string
          utilisateur_id?: string | null
        }
        Update: {
          archive_le?: string | null
          cree_le?: string
          entreprise_id?: string | null
          formateur_id?: string
          id?: string
          of_id?: string
          stagiaire_email?: string
          stagiaire_nom?: string
          stagiaire_poste?: string
          stagiaire_prenom?: string
          stagiaire_situation_handicap?: string
          stagiaire_telephone?: string
          utilisateur_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stagiaire_entreprise_id_fkey"
            columns: ["entreprise_id"]
            isOneToOne: false
            referencedRelation: "entreprise_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stagiaire_formateur_id_fkey"
            columns: ["formateur_id"]
            isOneToOne: false
            referencedRelation: "formateur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stagiaire_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stagiaire_utilisateur_id_fkey"
            columns: ["utilisateur_id"]
            isOneToOne: false
            referencedRelation: "utilisateur"
            referencedColumns: ["id"]
          },
        ]
      }
      stagiaire_dossier: {
        Row: {
          dossier_id: string
          id: string
          poste_occupe: string
          rang: number
          stagiaire_id: string
          statut_assiduite: string
        }
        Insert: {
          dossier_id: string
          id?: string
          poste_occupe?: string
          rang?: number
          stagiaire_id: string
          statut_assiduite?: string
        }
        Update: {
          dossier_id?: string
          id?: string
          poste_occupe?: string
          rang?: number
          stagiaire_id?: string
          statut_assiduite?: string
        }
        Relationships: [
          {
            foreignKeyName: "stagiaire_dossier_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossier_formation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stagiaire_dossier_stagiaire_id_fkey"
            columns: ["stagiaire_id"]
            isOneToOne: false
            referencedRelation: "stagiaire"
            referencedColumns: ["id"]
          },
        ]
      }
      utilisateur: {
        Row: {
          actif: boolean
          cree_le: string
          email: string
          id: string
          nom: string
          of_id: string
          prenom: string
          role: string
          supprime_le: string | null
        }
        Insert: {
          actif?: boolean
          cree_le?: string
          email: string
          id: string
          nom?: string
          of_id: string
          prenom?: string
          role: string
          supprime_le?: string | null
        }
        Update: {
          actif?: boolean
          cree_le?: string
          email?: string
          id?: string
          nom?: string
          of_id?: string
          prenom?: string
          role?: string
          supprime_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utilisateur_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
      version_objet: {
        Row: {
          auteur_id: string | null
          cree_le: string
          id: string
          libelle: string
          objet_id: string
          of_id: string
          snapshot: Json
          type: string
        }
        Insert: {
          auteur_id?: string | null
          cree_le?: string
          id?: string
          libelle?: string
          objet_id: string
          of_id: string
          snapshot: Json
          type: string
        }
        Update: {
          auteur_id?: string | null
          cree_le?: string
          id?: string
          libelle?: string
          objet_id?: string
          of_id?: string
          snapshot?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "version_objet_of_id_fkey"
            columns: ["of_id"]
            isOneToOne: false
            referencedRelation: "organisme_formation"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dossier_formation_apprenant: {
        Row: {
          archive_le: string | null
          coffre_ouvert: boolean | null
          cree_le: string | null
          dossier_reference: string | null
          formateur_id: string | null
          formation_date_debut: string | null
          formation_date_fin: string | null
          formation_duree_heures_distanciel: number | null
          formation_duree_heures_presentiel: number | null
          formation_duree_heures_total: number | null
          formation_duree_jours: number | null
          formation_id: string | null
          formation_lien_visio: string | null
          formation_lieu_adresse: string | null
          formation_lieu_nom: string | null
          formation_modalite: string | null
          formation_niveau: string | null
          formation_objectifs: string | null
          formation_objectifs_atteints: string | null
          formation_opco: string | null
          formation_prerequis: string | null
          formation_programme: string | null
          formation_public_vise: string | null
          formation_titre: string | null
          id: string | null
          maj_le: string | null
          mode_financement: string | null
          of_id: string | null
          signature_lieu: string | null
          sous_statut: string | null
          termine_le: string | null
          valide_le: string | null
        }
        Relationships: []
      }
      formateur_public: {
        Row: {
          formateur_bio: string | null
          formateur_domaines: Json | null
          formateur_email: string | null
          formateur_linkedin: string | null
          formateur_nom: string | null
          formateur_prenom: string | null
          id: string | null
          of_id: string | null
          statut_candidature: string | null
        }
        Relationships: []
      }
      organisme_public: {
        Row: {
          couleur: string | null
          id: string | null
          of_adresse: string | null
          of_certification_complementaire_numero: string | null
          of_dreets_region: string | null
          of_email_pedagogie: string | null
          of_forme_juridique: string | null
          of_nda_numero: string | null
          of_nom: string | null
          of_qualiopi_numero: string | null
          of_representant_civilite: string | null
          of_representant_nom: string | null
          of_representant_prenom: string | null
          of_siret: string | null
          of_telephone: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      s4m_a_atteint: {
        Args: { courant: string; seuil: string }
        Returns: boolean
      }
      s4m_apprenant_inscrit: {
        Args: { p_dossier_id: string }
        Returns: boolean
      }
      s4m_assurer_profil: { Args: never; Returns: string }
      s4m_coffre_ouvert_apprenant: {
        Args: { p_formation_id: string }
        Returns: boolean
      }
      s4m_dossier_interne: { Args: { p_dossier_id: string }; Returns: boolean }
      s4m_dossier_lisible: { Args: { p_dossier_id: string }; Returns: boolean }
      s4m_dossier_modifiable: {
        Args: { p_dossier_id: string }
        Returns: boolean
      }
      s4m_dossiers_apprenant: {
        Args: never
        Returns: {
          archive_le: string
          coffre_ouvert: boolean
          cree_le: string
          dossier_reference: string
          formateur_id: string
          formation_date_debut: string
          formation_date_fin: string
          formation_duree_heures_distanciel: number
          formation_duree_heures_presentiel: number
          formation_duree_heures_total: number
          formation_duree_jours: number
          formation_id: string
          formation_lien_visio: string
          formation_lieu_adresse: string
          formation_lieu_nom: string
          formation_modalite: string
          formation_niveau: string
          formation_objectifs: string
          formation_objectifs_atteints: string
          formation_opco: string
          formation_prerequis: string
          formation_programme: string
          formation_public_vise: string
          formation_titre: string
          id: string
          maj_le: string
          mode_financement: string
          of_id: string
          signature_lieu: string
          sous_statut: string
          termine_le: string
          valide_le: string
        }[]
      }
      s4m_est_admin: { Args: never; Returns: boolean }
      s4m_est_service: { Args: never; Returns: boolean }
      s4m_formateur_id: { Args: never; Returns: string }
      s4m_formateur_valide_id: { Args: never; Returns: string }
      s4m_formateurs_publics: {
        Args: never
        Returns: {
          formateur_bio: string
          formateur_domaines: Json
          formateur_email: string
          formateur_linkedin: string
          formateur_nom: string
          formateur_prenom: string
          id: string
          of_id: string
          statut_candidature: string
        }[]
      }
      s4m_of_id: { Args: never; Returns: string }
      s4m_organisme_public: {
        Args: never
        Returns: {
          couleur: string
          id: string
          of_adresse: string
          of_certification_complementaire_numero: string
          of_dreets_region: string
          of_email_pedagogie: string
          of_forme_juridique: string
          of_nda_numero: string
          of_nom: string
          of_qualiopi_numero: string
          of_representant_civilite: string
          of_representant_nom: string
          of_representant_prenom: string
          of_siret: string
          of_telephone: string
        }[]
      }
      s4m_piece_espace_apprenant: { Args: { p_code: string }; Returns: boolean }
      s4m_rang_statut: { Args: { s: string }; Returns: number }
      s4m_role: { Args: never; Returns: string }
      s4m_stagiaire_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
