'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { shareReport, updateShareRole, unshareReport } from '@/app/actions';
import { Loader2, Share2, UserPlus, Users, X, Edit, Eye, Trash2, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ShareRole } from '@/lib/types';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string;
  ownerId: string;
  onShareSuccess?: () => void;
  collaborators?: Record<string, { role: ShareRole; addedBy: string; addedAt: string; email?: string }>;
}

export function ShareDialog({ isOpen, onClose, reportId, ownerId, onShareSuccess, collaborators = {} }: ShareDialogProps) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<ShareRole>('view');
  const [isLoading, setIsLoading] = React.useState(false);
  const [updatingCollaborator, setUpdatingCollaborator] = React.useState<string | null>(null);
  const { toast } = useToast();

  const handleShare = async () => {
    if (!email.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address.',
        variant: 'destructive',
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      await shareReport(ownerId, reportId, email.trim(), role);
      
      toast({
        title: 'Report Shared',
        description: `Report has been shared with ${email} as ${role}.`,
      });
      
      setEmail('');
      setRole('view');
      onClose();
      onShareSuccess?.();
    } catch (error: any) {
      console.error('Error sharing report:', error);
      toast({
        title: 'Sharing Failed',
        description: error.message || 'Failed to share the report.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateRole = async (collaboratorId: string, newRole: ShareRole) => {
    setUpdatingCollaborator(collaboratorId);
    try {
      await updateShareRole(ownerId, reportId, collaboratorId, newRole);
      toast({
        title: 'Role Updated',
        description: `Access level changed to ${newRole}.`,
      });
      onShareSuccess?.();
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update access level.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingCollaborator(null);
    }
  };

  const handleRemoveAccess = async (collaboratorId: string) => {
    setUpdatingCollaborator(collaboratorId);
    try {
      await unshareReport(ownerId, reportId, collaboratorId);
      toast({
        title: 'Access Removed',
        description: 'User no longer has access to this report.',
      });
      onShareSuccess?.();
    } catch (error: any) {
      console.error('Error removing access:', error);
      toast({
        title: 'Remove Failed',
        description: error.message || 'Failed to remove access.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingCollaborator(null);
    }
  };

  const handleClose = () => {
    if (!isLoading && !updatingCollaborator) {
      setEmail('');
      setRole('view');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Report
          </DialogTitle>
          <DialogDescription>
            Share this report with another user. They will be able to view or edit based on the role you assign.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {/* Current Collaborators Section */}
          {Object.keys(collaborators).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <Label className="text-sm font-medium">Current Collaborators</Label>
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {Object.entries(collaborators).map(([collaboratorId, collaborator]) => (
                  <div key={collaboratorId} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-xs font-medium text-blue-600">
                          {(collaborator.email || collaboratorId).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{collaborator.email || collaboratorId}</p>
                        <p className="text-xs text-gray-500">
                          Added {new Date(collaborator.addedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={collaborator.role === 'edit' ? 'default' : 'secondary'} className="text-xs">
                        {collaborator.role === 'edit' ? (
                          <>
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </>
                        )}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 w-6 p-0"
                            disabled={updatingCollaborator === collaboratorId}
                          >
                            {updatingCollaborator === collaboratorId ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Settings className="w-3 h-3" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(collaboratorId, 'view')}
                            disabled={collaborator.role === 'view' || updatingCollaborator === collaboratorId}
                          >
                            <Eye className="mr-2 h-3 w-3" />
                            Set to View
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(collaboratorId, 'edit')}
                            disabled={collaborator.role === 'edit' || updatingCollaborator === collaboratorId}
                          >
                            <Edit className="mr-2 h-3 w-3" />
                            Set to Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRemoveAccess(collaboratorId)}
                            disabled={updatingCollaborator === collaboratorId}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-3 w-3" />
                            Remove Access
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
              <Separator />
            </div>
          )}

          {/* Add New Collaborator Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              <Label className="text-sm font-medium">Add New Collaborator</Label>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(value: ShareRole) => setRole(value)} disabled={isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">
                    <div className="flex flex-col">
                      <span className="font-medium">View</span>
                      <span className="text-sm text-muted-foreground">Can view the report and results</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="edit">
                    <div className="flex flex-col">
                      <span className="font-medium">Edit</span>
                      <span className="text-sm text-muted-foreground">Can view and update candidate statuses</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading || !!updatingCollaborator}>
            Cancel
          </Button>
          <Button onClick={handleShare} disabled={isLoading || !email.trim() || !!updatingCollaborator}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sharing...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Share Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
